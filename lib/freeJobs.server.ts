import "server-only";

import { createHash } from "node:crypto";

import { Job } from "@/lib/types";
import { compareJobsByEmployerPriority, getEmployerPriority } from "@/lib/employerPriority";
import { loadJobListingSnapshot, saveJobListingSnapshot } from "@/lib/jobListingStore.server";
import { ADAPTERS } from "@/lib/freeJobs/adapters";
import { MIN_DESCRIPTION_CHARS, passesListCriteria } from "@/lib/freeJobs/criteria";
import { mapWithConcurrency } from "@/lib/freeJobs/http";
import { FREE_JOB_SOURCES } from "@/lib/freeJobs/sources";
import type { FreeJobSource } from "@/lib/freeJobs/types";

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
const SOURCE_CONCURRENCY = 6;
const HYDRATE_CONCURRENCY = 4;
const MAX_HYDRATED_PER_SOURCE = 60;

export interface FreeJobsResult {
  jobs: Job[];
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  failedSources: string[];
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
let inFlight: Promise<FreeJobsResult> | null = null;

const jobIdPrefix = (source: FreeJobSource) => `free-${source.id}-`;

function buildJob(
  source: FreeJobSource,
  candidate: { externalId: string; title: string; location: string; applyLink: string; postedAt: string | null },
  description: string
): Job {
  const job: Job = {
    id: `${jobIdPrefix(source)}${candidate.externalId.replace(/[^a-zA-Z0-9]+/g, "-").slice(-80)}`,
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
  signal: AbortSignal
): Promise<{ source: FreeJobSource; jobs: Job[]; ok: boolean; seen: number }> {
  const startedAt = Date.now();
  try {
    signal.throwIfAborted();
    const adapter = ADAPTERS[source.adapter];
    const candidates = await adapter.list(source, signal);
    const matching = candidates.filter((candidate) =>
      passesListCriteria(candidate, { skipLocation: candidate.locationUnknown })
    );

    const jobs: Job[] = [];
    const needDescription = matching.filter((candidate) => !candidate.description);
    for (const candidate of matching) {
      if (candidate.description && candidate.description.length >= MIN_DESCRIPTION_CHARS) {
        jobs.push(buildJob(source, candidate, candidate.description));
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
        if (!passesListCriteria(refined)) continue;
        jobs.push(buildJob(source, refined, detail.description));
      }
    }
    console.info(
      `free jobs: ${source.id} seen=${candidates.length} matched=${matching.length} kept=${jobs.length} ms=${Date.now() - startedAt}`
    );
    return { source, jobs, ok: true, seen: candidates.length };
  } catch (error) {
    console.error(`free jobs: ${source.id} failed`, error instanceof Error ? error.message : error);
    return { source, jobs: [], ok: false, seen: 0 };
  }
}

async function runLiveSync(previous: Job[]): Promise<FreeJobsResult> {
  lastAttemptAt = Date.now();
  const signal = AbortSignal.timeout(SYNC_DEADLINE_MS);
  // Longest-unsynced first, so anything cut off by the deadline goes first next time.
  const ordered = [...FREE_JOB_SOURCES].sort(
    (a, b) => (sourceSyncedAt.get(a.id) ?? 0) - (sourceSyncedAt.get(b.id) ?? 0)
  );
  const { results } = await mapWithConcurrency(ordered, SOURCE_CONCURRENCY, (source) =>
    syncSource(source, signal)
  );
  const finishedAt = Date.now();
  for (const result of results) if (result.ok) sourceSyncedAt.set(result.source.id, finishedAt);

  const succeeded = results.filter((result) => result.ok);
  const failedIds = new Set(
    FREE_JOB_SOURCES.filter((source) => !succeeded.some((result) => result.source.id === source.id)).map(
      (source) => source.id
    )
  );
  const failedSources = FREE_JOB_SOURCES.filter((source) => failedIds.has(source.id)).map(
    (source) => source.employer
  );

  // A source that answered replaces its old listings (closed jobs disappear);
  // a source that failed keeps what we already had, so a flaky site never
  // wipes its jobs.
  // Kept jobs are re-checked against today's rules, so changing the criteria
  // (or a posting ageing out) also cleans up what a failed site left behind.
  const kept = previous.filter(
    (job) =>
      FREE_JOB_SOURCES.some((source) => failedIds.has(source.id) && job.id.startsWith(jobIdPrefix(source))) &&
      passesListCriteria(job)
  );
  const fresh = succeeded.flatMap((result) => result.jobs);
  const byId = new Map<string, Job>();
  for (const job of [...fresh, ...kept]) if (!byId.has(job.id)) byId.set(job.id, job);
  const jobs = [...byId.values()].sort(compareJobsByEmployerPriority);

  const previousIds = new Set(previous.map((job) => job.id));
  const newJobsCount = fresh.filter((job) => !previousIds.has(job.id)).length;
  const now = Date.now();

  if (jobs.length) {
    memory = { jobs, savedAt: now };
    await saveJobListingSnapshot("free", jobs, {
      attemptedSearches: FREE_JOB_SOURCES.length,
      failedSearches: failedSources.length,
      fetchedJobsCount: fresh.length,
      ...Object.fromEntries([...sourceSyncedAt].map(([id, at]) => [SYNCED_KEY + id, at])),
    });
  }

  return {
    jobs,
    attemptedSearches: FREE_JOB_SOURCES.length,
    successfulSearches: succeeded.length,
    failedSearches: failedSources.length,
    failedSources,
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
    if (key.startsWith(SYNCED_KEY) && typeof value === "number") {
      sourceSyncedAt.set(key.slice(SYNCED_KEY.length), value);
    }
  }
}

/** The saved listings with full descriptions, without ever contacting a career site. */
export async function getSavedFreeJobs(): Promise<Job[]> {
  if (!memory) {
    const snapshot = await loadJobListingSnapshot("free");
    if (snapshot) adoptSnapshot(snapshot);
  }
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
  const snapshot = memory
    ? { jobs: memory.jobs, savedAt: memory.savedAt }
    : await loadJobListingSnapshot("free");
  if (snapshot && !memory) adoptSnapshot(snapshot);

  const now = Date.now();
  const saved = (syncMode: FreeJobsResult["syncMode"], stale = false): FreeJobsResult => ({
    jobs: snapshot?.jobs || [],
    attemptedSearches: 0,
    successfulSearches: 0,
    failedSearches: 0,
    failedSources: [],
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

export function clearFreeJobsMemoryCache(): void {
  memory = null;
}
