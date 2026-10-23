import "server-only";

import { createHash } from "node:crypto";

import { Job } from "@/lib/types";
import { getEmployerPriority, sortJobsByEmployerPriority } from "@/lib/employerPriority";
import {
  getJobListingSavedAt,
  loadJobListingSnapshot,
  saveJobListingSnapshot,
} from "@/lib/jobListingStore.server";
import { ADAPTERS } from "@/lib/freeJobs/adapters";
import { MIN_DESCRIPTION_CHARS, passesListCriteria } from "@/lib/freeJobs/criteria";
import { mapWithConcurrency } from "@/lib/freeJobs/http";
import { FREE_JOB_SOURCES } from "@/lib/freeJobs/sources";
import { reconcileSource } from "@/lib/freeJobs/reconcile";
import type { FreeJobSource, JobCandidate } from "@/lib/freeJobs/types";

// These sources cost nothing, so the only limits are politeness and time:
// a saved list is refreshed automatically once it is this old, and a manual
// refresh is accepted at most once per cooldown.
const AUTO_REFRESH_AFTER_MS = 6 * 60 * 60 * 1_000;
const MANUAL_REFRESH_COOLDOWN_MS = 5 * 60 * 1_000;
// Vercel stops the route at 60s; locally there is no such limit. Sources that
// have not finished by the deadline simply keep their saved listings and are
// synced first on the next refresh (see sourceSyncedAt), so repeated
// refreshes always converge.
const configuredDeadline = Number.parseInt(process.env.FREE_JOBS_SYNC_DEADLINE_SECONDS || "", 10);
const SYNC_DEADLINE_MS =
  (Number.isFinite(configuredDeadline) && configuredDeadline > 0
    ? configuredDeadline
    : process.env.VERCEL
      ? 50
      : 150) * 1_000;
const SYNCED_KEY = "synced_";
// Postings that were downloaded once and turned out not to qualify (too old,
// wrong place or title). Remembered so they are not downloaded again on every
// refresh; kept in the saved snapshot so it survives a restart.
const REJECTED_KEY = "rej_";
// How long each source took, kept in the snapshot so the slowest-first order
// survives a server restart (on Vercel every cold start would forget it).
const DURATION_KEY = "dur_";
const REJECTED_TTL_MS = 7 * 86_400_000;
const MAX_REMEMBERED_REJECTIONS = 1_500;
const SOURCE_CONCURRENCY = 16;
// One slow site must not hold the whole refresh; it keeps its saved listings.
const SOURCE_TIMEOUT_MS = 25_000;
const HYDRATE_CONCURRENCY = 6;
const MAX_HYDRATED_PER_SOURCE = 60;

export interface FreeJobsResult {
  jobs: Job[];
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  failedSources: string[];
  /** Sites still working when the refresh answered; they join the list when done. */
  lateSources: string[];
  /** Sites with more jobs than we read; their older listings were kept. */
  incompleteSources: string[];
  fetchedJobsCount?: number;
  newJobsCount?: number;
  syncedAt: number | null;
  nextSyncAt: number | null;
  syncMode: "empty" | "saved" | "cooldown" | "live" | "stale";
  fromCache: boolean;
  stale: boolean;
}

interface Memory {
  jobs: Job[];
  savedAt: number;
}
let memory: Memory | null = null;
let lastAttemptAt = 0;
// When each source last answered successfully (persisted in the snapshot).
const sourceSyncedAt = new Map<string, number>();
// How long each source took last time, so the slow ones can be started first.
const sourceDurationMs = new Map<string, number>();
const rejectedAt = new Map<string, number>();
let inFlight: Promise<FreeJobsResult> | null = null;

const jobIdPrefix = (source: FreeJobSource) => `free-${source.id}-`;
const jobIdFor = (source: FreeJobSource, externalId: string) =>
  `${jobIdPrefix(source)}${externalId.replace(/[^a-zA-Z0-9]+/g, "-").slice(-80)}`;

function buildJob(
  source: FreeJobSource,
  candidate: { externalId: string; title: string; location: string; applyLink: string; postedAt: string | null },
  description: string
): Job {
  const job: Job = {
    id: jobIdFor(source, candidate.externalId),
    title: candidate.title.trim(),
    company: source.employer,
    location: candidate.location.trim(),
    salary: null,
    description,
    applyLink: candidate.applyLink || null,
    source: `${source.employer} careers site`,
    postedAt: candidate.postedAt,
    directEmployer: true,
  };
  job.employerTier = getEmployerPriority(job).tier;
  return job;
}

async function syncSource(
  source: FreeJobSource,
  signal: AbortSignal,
  previousById: Map<string, Job>
): Promise<{
  source: FreeJobSource;
  jobs: Job[];
  ok: boolean;
  seen: number;
  ms: number;
  incomplete: boolean;
  /** Ids of every posting the site listed, whether or not it passed our filters. */
  listedIds: Set<string>;
}> {
  const startedAt = Date.now();
  try {
    signal.throwIfAborted();
    const adapter = ADAPTERS[source.adapter];
    const candidates = await adapter.list(source, signal);
    const incomplete = candidates.incomplete === true;
    const matching = candidates.filter((candidate) =>
      passesListCriteria(candidate, { skipLocation: candidate.locationUnknown })
    );

    const jobs: Job[] = [];
    const needDescription: JobCandidate[] = [];
    let reused = 0;
    let skipped = 0;
    for (const candidate of matching) {
      const candidateId = jobIdFor(source, candidate.externalId);
      const rejectedTime = rejectedAt.get(candidateId);
      if (rejectedTime && Date.now() - rejectedTime < REJECTED_TTL_MS) {
        skipped += 1;
        continue;
      }
      const known = previousById.get(candidateId);
      if (known && known.description.length >= MIN_DESCRIPTION_CHARS) {
        // Downloaded on an earlier refresh: keep it instead of fetching the page
        // again, which is what made refreshes slow. The list only overrides what
        // it actually reports; the age rule is applied again either way.
        const refreshed: Job = candidate.locationUnknown
          ? known
          : {
              ...known,
              title: candidate.title.trim() || known.title,
              location: candidate.location.trim() || known.location,
              postedAt: candidate.postedAt ?? known.postedAt,
            };
        if (passesListCriteria(refreshed)) {
          jobs.push(refreshed);
          reused += 1;
        }
      } else if (candidate.description) {
        if (candidate.description.length >= MIN_DESCRIPTION_CHARS) {
          jobs.push(buildJob(source, candidate, candidate.description));
        }
      } else {
        needDescription.push(candidate);
      }
    }
    if (adapter.hydrate && needDescription.length) {
      const { results } = await mapWithConcurrency(
        needDescription.slice(0, MAX_HYDRATED_PER_SOURCE),
        HYDRATE_CONCURRENCY,
        async (candidate) => {
          const detail = await adapter.hydrate!(source, candidate, signal);
          return { candidate, detail };
        }
      );
      for (const { candidate, detail } of results) {
        if (detail.description.length < MIN_DESCRIPTION_CHARS) continue;
        // The detail call can carry a more exact date than the list did;
        // re-check recency with it.
        const refined = {
          ...candidate,
          postedAt: detail.postedAt ?? candidate.postedAt,
          // Sitemap sources only learn the real title/location here.
          location: detail.location ?? candidate.location,
          title: detail.title || candidate.title,
        };
        if (!passesListCriteria(refined)) {
          rejectedAt.set(jobIdFor(source, candidate.externalId), Date.now());
          continue;
        }
        jobs.push(buildJob(source, refined, detail.description));
      }
    }
    console.info(
      `free jobs: ${source.id} seen=${candidates.length} matched=${matching.length} kept=${jobs.length} reused=${reused} skipped=${skipped} incomplete=${incomplete} ms=${Date.now() - startedAt}`
    );
    const listedIds = new Set(candidates.map((candidate) => jobIdFor(source, candidate.externalId)));
    return { source, jobs, ok: true, seen: candidates.length, ms: Date.now() - startedAt, incomplete, listedIds };
  } catch (error) {
    console.error(`free jobs: ${source.id} failed`, error instanceof Error ? error.message : error);
    return {
      source,
      jobs: [],
      ok: false,
      seen: 0,
      ms: Date.now() - startedAt,
      incomplete: false,
      listedIds: new Set<string>(),
    };
  }
}

// A refresh answers once this much time has passed, with whatever sites have
// finished. A site still working carries on in the background and is merged
// into the saved list when it finishes (its saved listings show until then),
// so one slow career site no longer holds up the whole refresh.
const configuredBudget = Number.parseInt(process.env.FREE_JOBS_REFRESH_BUDGET_SECONDS || "", 10);
const REFRESH_BUDGET_MS =
  (Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 12) * 1_000;

type SourceResult = Awaited<ReturnType<typeof syncSource>>;

function snapshotMetadata(now: number, failedCount: number, fetchedCount: number) {
  return {
    attemptedSearches: FREE_JOB_SOURCES.length,
    failedSearches: failedCount,
    fetchedJobsCount: fetchedCount,
    ...Object.fromEntries([...sourceSyncedAt].map(([id, at]) => [SYNCED_KEY + id, at])),
    ...Object.fromEntries([...sourceDurationMs].map(([id, ms]) => [DURATION_KEY + id, ms])),
    ...Object.fromEntries(
      [...rejectedAt]
        .filter(([, at]) => now - at < REJECTED_TTL_MS)
        .slice(-MAX_REMEMBERED_REJECTIONS)
        .map(([id, at]) => [REJECTED_KEY + id, at])
    ),
  };
}

// A source that finished after the refresh it belonged to had already answered.
async function applyLateResult(result: SourceResult, syncStartedAt: number): Promise<void> {
  if (!result.ok || !memory) return;
  // A newer refresh already brought this source up to date.
  if ((sourceSyncedAt.get(result.source.id) ?? 0) > syncStartedAt) return;
  const now = Date.now();
  sourceSyncedAt.set(result.source.id, now);
  sourceDurationMs.set(result.source.id, result.ms);
  const prefix = jobIdPrefix(result.source);
  const byId = new Map<string, Job>();
  const sourceJobs = reconcileSource(result, memory.jobs.filter((job) => job.id.startsWith(prefix)), now, passesListCriteria);
  for (const job of [...sourceJobs, ...memory.jobs.filter((job) => !job.id.startsWith(prefix))]) {
    if (!byId.has(job.id)) byId.set(job.id, job);
  }
  const jobs = sortJobsByEmployerPriority([...byId.values()]);
  memory = { jobs, savedAt: now };
  await saveJobListingSnapshot("free", jobs, snapshotMetadata(now, 0, result.jobs.length));
  console.info(`free jobs: late source ${result.source.id} merged (${result.jobs.length} listings)`);
}

async function runLiveSync(
  previous: Job[],
  options: { waitForAll?: boolean } = {}
): Promise<FreeJobsResult> {
  lastAttemptAt = Date.now();
  const syncStartedAt = lastAttemptAt;
  const signal = AbortSignal.timeout(SYNC_DEADLINE_MS);
  // Sources that fell behind (a failed or cut-off one) go first so repeated
  // refreshes converge; the rest start slowest-first, which keeps the total
  // time close to the single slowest source instead of the sum of the waves.
  const newestSync = Math.max(0, ...FREE_JOB_SOURCES.map((source) => sourceSyncedAt.get(source.id) ?? 0));
  const isBehind = (source: FreeJobSource) =>
    (sourceSyncedAt.get(source.id) ?? 0) < newestSync - 60_000;
  const ordered = [...FREE_JOB_SOURCES].sort((a, b) => {
    const behindA = isBehind(a);
    const behindB = isBehind(b);
    if (behindA !== behindB) return behindA ? -1 : 1;
    if (behindA) return (sourceSyncedAt.get(a.id) ?? 0) - (sourceSyncedAt.get(b.id) ?? 0);
    return (sourceDurationMs.get(b.id) ?? 0) - (sourceDurationMs.get(a.id) ?? 0);
  });
  const previousById = new Map(previous.map((job) => [job.id, job] as const));

  const results: SourceResult[] = [];
  let responded = false;
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < ordered.length) {
      const source = ordered[nextIndex++];
      const result = await syncSource(
        source,
        AbortSignal.any([signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]),
        previousById
      );
      results.push(result);
      if (responded) void applyLateResult(result, syncStartedAt).catch(() => undefined);
    }
  };
  const pool = Promise.all(
    Array.from({ length: Math.min(SOURCE_CONCURRENCY, ordered.length) }, worker)
  );
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    pool,
    new Promise<void>((resolve) => {
      // A scheduled run has nobody waiting for an answer, so it waits for every source.
      if (options.waitForAll) return;
      budgetTimer = setTimeout(resolve, REFRESH_BUDGET_MS);
    }),
  ]);
  clearTimeout(budgetTimer);
  responded = true;
  const finished = [...results]; // only what is done right now; later ones merge themselves
  const finishedIds = new Set(finished.map((result) => result.source.id));
  const lateSources = FREE_JOB_SOURCES.filter((source) => !finishedIds.has(source.id)).map(
    (source) => source.employer
  );

  const finishedAt = Date.now();
  for (const result of finished) {
    if (!result.ok) continue;
    sourceSyncedAt.set(result.source.id, finishedAt);
    sourceDurationMs.set(result.source.id, result.ms);
  }

  const succeeded = finished.filter((result) => result.ok);
  // Sites that did not answer (failed, or still working) keep their saved listings.
  const notUpdatedIds = new Set(
    FREE_JOB_SOURCES.filter((source) => !succeeded.some((result) => result.source.id === source.id)).map(
      (source) => source.id
    )
  );
  const failedSources = finished.filter((result) => !result.ok).map((result) => result.source.employer);

  // A source that answered is reconciled with its old listings (a posting is
  // dropped once it is gone for two complete syncs); one that did not keeps
  // what we already had, so a flaky site never wipes its jobs. Kept jobs are
  // re-checked against today's rules, so changing the criteria (or a posting
  // ageing out) also cleans up what such a site left.
  const kept = previous.filter(
    (job) =>
      FREE_JOB_SOURCES.some((source) => notUpdatedIds.has(source.id) && job.id.startsWith(jobIdPrefix(source))) &&
      passesListCriteria(job)
  );
  // A site that stopped at its page limit did not show us every job. The ones we
  // never read are not closed, so reconcileSource keeps them.
  const incompleteResults = succeeded.filter((result) => result.incomplete);
  const reconciled = succeeded.flatMap((result) =>
    reconcileSource(
      result,
      previous.filter((job) => job.id.startsWith(jobIdPrefix(result.source))),
      finishedAt,
      passesListCriteria
    )
  );
  const fresh = succeeded.flatMap((result) => result.jobs);
  const byId = new Map<string, Job>();
  for (const job of [...reconciled, ...kept]) if (!byId.has(job.id)) byId.set(job.id, job);
  const jobs = sortJobsByEmployerPriority([...byId.values()]);

  const previousIds = new Set(previous.map((job) => job.id));
  const newJobsCount = fresh.filter((job) => !previousIds.has(job.id)).length;
  const now = Date.now();
  const sourcesMs = now - syncStartedAt;

  if (jobs.length) {
    memory = { jobs, savedAt: now };
    const persistStartedAt = Date.now();
    await saveJobListingSnapshot("free", jobs, snapshotMetadata(now, failedSources.length, fresh.length));
    console.info(
      `free jobs: TIMING sources=${sourcesMs}ms persist=${Date.now() - persistStartedAt}ms total=${Date.now() - syncStartedAt}ms late=${lateSources.length}`
    );
  }

  return {
    jobs,
    attemptedSearches: FREE_JOB_SOURCES.length,
    successfulSearches: succeeded.length,
    failedSearches: failedSources.length,
    failedSources,
    lateSources,
    incompleteSources: incompleteResults.map((result) => result.source.employer),
    fetchedJobsCount: succeeded.reduce((total, result) => total + result.seen, 0),
    newJobsCount,
    syncedAt: now,
    nextSyncAt: now + MANUAL_REFRESH_COOLDOWN_MS,
    syncMode: "live",
    fromCache: false,
    stale: false,
  };
}

function adoptSnapshot(snapshot: { jobs: Job[]; savedAt: number; metadata?: Record<string, number | null> }) {
  memory = { jobs: snapshot.jobs, savedAt: snapshot.savedAt };
  for (const [key, value] of Object.entries(snapshot.metadata || {})) {
    if (typeof value !== "number") continue;
    if (key.startsWith(SYNCED_KEY)) sourceSyncedAt.set(key.slice(SYNCED_KEY.length), value);
    else if (key.startsWith(DURATION_KEY)) sourceDurationMs.set(key.slice(DURATION_KEY.length), value);
    else if (key.startsWith(REJECTED_KEY)) rejectedAt.set(key.slice(REJECTED_KEY.length), value);
  }
}

// Each server instance keeps its own copy of the list in memory, so one
// instance can hold an older list than the stored snapshot another instance
// has just written. Before serving, ask storage (a cheap timestamp lookup,
// at most every few seconds) whether something newer exists and adopt it.
const BLOB_CHECK_INTERVAL_MS = 5_000;
const BLOB_CLOCK_TOLERANCE_MS = 5_000; // the stored time trails our own savedAt slightly
let lastBlobCheckAt = 0;

async function refreshMemoryFromStorage(): Promise<void> {
  const now = Date.now();
  if (memory && now - lastBlobCheckAt < BLOB_CHECK_INTERVAL_MS) return;
  lastBlobCheckAt = now;
  if (memory) {
    const storedAt = await getJobListingSavedAt("free");
    if (storedAt === null || storedAt <= memory.savedAt + BLOB_CLOCK_TOLERANCE_MS) return;
  }
  const snapshot = await loadJobListingSnapshot("free");
  if (snapshot && (!memory || snapshot.savedAt > memory.savedAt)) adoptSnapshot(snapshot);
}

/** The saved listings with full descriptions, without ever contacting a career site. */
export async function getSavedFreeJobs(): Promise<Job[]> {
  await refreshMemoryFromStorage();
  return memory?.jobs || [];
}

export function descriptionHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/**
 * The card-sized version of a listing: everything except the (large)
 * description, which is fetched when a job is opened. The hash stands in for
 * the description wherever the app needs to know whether it changed.
 */
export function toLiteJob(job: Job): Job {
  return { ...job, description: "", descriptionHash: job.descriptionHash || descriptionHash(job.description) };
}

async function load(forceRefresh: boolean): Promise<FreeJobsResult> {
  if (!FREE_JOB_SOURCES.length) {
    throw new Error("No free job sources are configured (lib/freeJobs/sources.ts)");
  }
  await refreshMemoryFromStorage();
  const snapshot = memory ? { jobs: memory.jobs, savedAt: memory.savedAt } : null;

  const now = Date.now();
  const saved = (syncMode: FreeJobsResult["syncMode"], stale = false): FreeJobsResult => ({
    jobs: snapshot?.jobs || [],
    attemptedSearches: 0,
    successfulSearches: 0,
    failedSearches: 0,
    failedSources: [],
    lateSources: [],
    incompleteSources: [],
    syncedAt: snapshot?.savedAt ?? null,
    nextSyncAt: lastAttemptAt ? lastAttemptAt + MANUAL_REFRESH_COOLDOWN_MS : null,
    syncMode,
    fromCache: true,
    stale,
  });

  const age = snapshot ? now - snapshot.savedAt : Infinity;
  if (forceRefresh && now - lastAttemptAt < MANUAL_REFRESH_COOLDOWN_MS) return saved("cooldown");
  if (!forceRefresh && snapshot && age < AUTO_REFRESH_AFTER_MS) return saved("saved");

  try {
    return await runLiveSync(snapshot?.jobs || []);
  } catch (error) {
    if (snapshot) return saved("stale", true);
    throw error;
  }
}

export async function fetchFreeJobs(forceRefresh = false): Promise<FreeJobsResult> {
  if (inFlight) return inFlight;
  inFlight = load(forceRefresh).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// The scheduled (cron) run. It waits for every source instead of answering
// after REFRESH_BUDGET_MS, and does nothing if the saved list is already fresh,
// because a manual Refresh (or another instance) got there first.
const SCHEDULED_MIN_GAP_MS = 20 * 60 * 1000;

export interface ScheduledSyncResult {
  ran: boolean;
  reason?: string;
  jobs?: number;
  newJobs?: number;
  failedSources?: string[];
  lateSources?: string[];
  durationMs: number;
}

export async function runScheduledSync(): Promise<ScheduledSyncResult> {
  const startedAt = Date.now();
  const done = (result: Omit<ScheduledSyncResult, "durationMs">): ScheduledSyncResult => ({
    ...result,
    durationMs: Date.now() - startedAt,
  });

  if (inFlight) {
    await inFlight.catch(() => undefined);
    return done({ ran: false, reason: "a sync was already running" });
  }
  await refreshMemoryFromStorage();
  if (memory && Date.now() - memory.savedAt < SCHEDULED_MIN_GAP_MS) {
    return done({ ran: false, reason: "the saved list was refreshed recently" });
  }

  const tracked = runLiveSync(memory?.jobs || [], { waitForAll: true }).finally(() => {
    inFlight = null;
  });
  inFlight = tracked;
  const result = await tracked;
  return done({
    ran: true,
    jobs: result.jobs.length,
    newJobs: result.newJobsCount,
    failedSources: result.failedSources,
    lateSources: result.lateSources,
  });
}

export function clearFreeJobsMemoryCache(): void {
  memory = null;
}
