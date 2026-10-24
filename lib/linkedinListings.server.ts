import "server-only";

import { Job } from "@/lib/types";
import { getEmployerPriority, sortJobsByEmployerPriority } from "@/lib/employerPriority";
import {
  getJobListingSavedAt,
  loadJobListingSnapshot,
  saveJobListingSnapshot,
} from "@/lib/jobListingStore.server";
import { passesListCriteria } from "@/lib/freeJobs/criteria";
import { reconcileSource } from "@/lib/freeJobs/reconcile";
import { crawlLinkedInCards, type LinkedInCard } from "@/lib/linkedinJobs.server";

// The "LinkedIn only" list: LinkedIn's public search, kept as a saved snapshot
// like the career-site list, so the toggle answers from storage instead of
// waiting on LinkedIn. LinkedIn refuses a client after a handful of requests,
// so each sync reads only the next few searches (a cursor remembers where it
// stopped) and the full set of searches is covered over several syncs. A block
// never costs saved jobs.
const AUTO_REFRESH_AFTER_MS = 6 * 60 * 60 * 1_000;
const MANUAL_REFRESH_COOLDOWN_MS = 30 * 60 * 1_000;
// The cron runs every 2 hours; this only stops two runs close together.
const SCHEDULED_MIN_GAP_MS = 90 * 60 * 1_000;
const SYNC_DEADLINE_MS = 40_000;
const BLOB_CHECK_INTERVAL_MS = 5_000;
const BLOB_CLOCK_TOLERANCE_MS = 5_000;

export interface LinkedInListingsResult {
  jobs: Job[];
  syncMode: "saved" | "cooldown" | "live" | "stale";
  syncedAt: number | null;
  nextSyncAt: number | null;
  newJobsCount?: number;
  attemptedRequests: number;
  failedRequests: number;
  /** LinkedIn refused a request, so this sync stopped early. */
  blocked: boolean;
  /** Searches read in this sync, and how many make up a full cycle. */
  slotsRead: number;
  totalSlots: number;
}

interface Memory {
  jobs: Job[];
  savedAt: number;
}

// Which search the next sync starts at; saved with the snapshot.
const CURSOR_KEY = "cursor";

let memory: Memory | null = null;
let cursor = 0;
let lastAttemptAt = 0;
let lastBlobCheckAt = 0;
let inFlight: Promise<LinkedInListingsResult> | null = null;

const jobIdFor = (card: LinkedInCard) => `linkedin-${card.id}`;

// The client recognises this sentence and fetches the real description when the
// job is opened or tailored (see needsLinkedInDescription in app/page.tsx).
function buildJob(card: LinkedInCard): Job {
  const job: Job = {
    id: jobIdFor(card),
    title: card.title,
    company: card.company,
    location: card.location,
    salary: null,
    description: `LinkedIn listing for ${card.title} at ${card.company} in ${card.location}. The full description will be loaded before tailoring.`,
    applyLink: card.applyLink,
    source: "LinkedIn",
    postedAt: card.postedIso,
  };
  job.employerTier = getEmployerPriority(job).tier;
  return job;
}

async function refreshMemoryFromStorage(): Promise<void> {
  const now = Date.now();
  if (memory && now - lastBlobCheckAt < BLOB_CHECK_INTERVAL_MS) return;
  lastBlobCheckAt = now;
  if (memory) {
    const storedAt = await getJobListingSavedAt("linkedin");
    if (storedAt === null || storedAt <= memory.savedAt + BLOB_CLOCK_TOLERANCE_MS) return;
  }
  const snapshot = await loadJobListingSnapshot("linkedin");
  if (snapshot && (!memory || snapshot.savedAt > memory.savedAt)) {
    memory = { jobs: snapshot.jobs, savedAt: snapshot.savedAt };
    const saved = snapshot.metadata?.[CURSOR_KEY];
    if (typeof saved === "number") cursor = saved;
  }
}

async function runLiveSync(previous: Job[]): Promise<LinkedInListingsResult> {
  lastAttemptAt = Date.now();
  const crawl = await crawlLinkedInCards(AbortSignal.timeout(SYNC_DEADLINE_MS), cursor);
  cursor = crawl.nextCursor;
  const now = Date.now();

  const matching = crawl.cards.filter((card) =>
    passesListCriteria({ title: card.title, location: card.location, postedAt: card.postedIso })
  );
  // A search only reads the newest page or two of each role family, so a saved
  // job that is not on those pages is not known to be closed: it has most likely
  // just moved deeper. Saved jobs are therefore never dropped for going missing
  // (`incomplete`), only when they age out of the 30-day window.
  const jobs = sortJobsByEmployerPriority(
    reconcileSource(
      {
        jobs: matching.map(buildJob),
        listedIds: new Set(crawl.cards.map(jobIdFor)),
        incomplete: true,
      },
      previous,
      now,
      passesListCriteria
    )
  );

  const previousIds = new Set(previous.map((job) => job.id));
  const newJobsCount = matching.filter((card) => !previousIds.has(jobIdFor(card))).length;

  if (jobs.length) {
    memory = { jobs, savedAt: now };
    await saveJobListingSnapshot("linkedin", jobs, {
      attemptedRequests: crawl.attemptedRequests,
      failedRequests: crawl.failedRequests,
      blocked: crawl.blocked ? 1 : 0,
      [CURSOR_KEY]: crawl.nextCursor,
    });
  }
  console.info(
    `linkedin: requests=${crawl.attemptedRequests} failed=${crawl.failedRequests} blocked=${crawl.blocked} slots=${crawl.slotsRead}/${crawl.totalSlots} cursor=${crawl.nextCursor} cards=${crawl.cards.length} matched=${matching.length} new=${newJobsCount} saved=${jobs.length}`
  );

  return {
    jobs,
    syncMode: "live",
    syncedAt: now,
    nextSyncAt: now + MANUAL_REFRESH_COOLDOWN_MS,
    newJobsCount,
    attemptedRequests: crawl.attemptedRequests,
    failedRequests: crawl.failedRequests,
    blocked: crawl.blocked,
    slotsRead: crawl.slotsRead,
    totalSlots: crawl.totalSlots,
  };
}

async function load(forceRefresh: boolean): Promise<LinkedInListingsResult> {
  await refreshMemoryFromStorage();
  const snapshot = memory;
  const now = Date.now();
  const saved = (syncMode: "saved" | "cooldown" | "stale"): LinkedInListingsResult => ({
    jobs: snapshot?.jobs ?? [],
    syncMode,
    syncedAt: snapshot?.savedAt ?? null,
    nextSyncAt: lastAttemptAt ? lastAttemptAt + MANUAL_REFRESH_COOLDOWN_MS : null,
    attemptedRequests: 0,
    failedRequests: 0,
    blocked: false,
    slotsRead: 0,
    totalSlots: 0,
  });

  if (forceRefresh && now - lastAttemptAt < MANUAL_REFRESH_COOLDOWN_MS) return saved("cooldown");
  if (!forceRefresh && snapshot && now - snapshot.savedAt < AUTO_REFRESH_AFTER_MS) return saved("saved");

  try {
    return await runLiveSync(snapshot?.jobs ?? []);
  } catch (error) {
    console.warn("linkedin sync failed", error instanceof Error ? error.message : error);
    if (snapshot) return saved("stale");
    throw error;
  }
}

export async function fetchLinkedInListings(forceRefresh = false): Promise<LinkedInListingsResult> {
  if (inFlight) return inFlight;
  inFlight = load(forceRefresh).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export interface ScheduledLinkedInResult {
  ran: boolean;
  reason?: string;
  jobs?: number;
  newJobs?: number;
  blocked?: boolean;
  slotsRead?: number;
}

// The cron run. LinkedIn is read far less often than the career sites: it is
// skipped unless the saved list is several hours old.
export async function runScheduledLinkedInSync(): Promise<ScheduledLinkedInResult> {
  if (inFlight) {
    await inFlight.catch(() => undefined);
    return { ran: false, reason: "a LinkedIn sync was already running" };
  }
  await refreshMemoryFromStorage();
  if (memory && Date.now() - memory.savedAt < SCHEDULED_MIN_GAP_MS) {
    return { ran: false, reason: "the saved LinkedIn list is recent" };
  }
  const tracked = runLiveSync(memory?.jobs ?? []).finally(() => {
    inFlight = null;
  });
  inFlight = tracked;
  const result = await tracked;
  return {
    ran: true,
    jobs: result.jobs.length,
    newJobs: result.newJobsCount,
    blocked: result.blocked,
    slotsRead: result.slotsRead,
  };
}

export function clearLinkedInListingsMemory(): void {
  memory = null;
  lastAttemptAt = 0;
  cursor = 0;
}
