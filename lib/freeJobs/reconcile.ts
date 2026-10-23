import type { Job } from "@/lib/types";

// A posting is only treated as closed after this many complete syncs in a row
// stopped listing it, at least MISS_GAP_MS apart. One odd response (a partial
// page, a hiccup) must not wipe a job that is still open.
export const MISSES_BEFORE_CLOSED = 2;
export const MISS_GAP_MS = 30 * 60 * 1_000;

export interface SourceListing {
  /** Postings that passed our filters this sync. */
  jobs: Job[];
  /** Ids of every posting the site listed, whether or not it passed our filters. */
  listedIds: Set<string>;
  /** The site stopped at a paging limit, so it did not show every posting. */
  incomplete: boolean;
}

/**
 * The saved listings of one site after it answered: what it lists now, plus
 * earlier ones it did not list this time and has not yet missed long enough to
 * count as closed. Postings it still lists but that no longer pass our filters
 * (aged out, moved elsewhere) are dropped straight away.
 */
export function reconcileSource(
  listing: SourceListing,
  previousJobs: Job[],
  now: number,
  isEligible: (job: Job) => boolean
): Job[] {
  const previousById = new Map(previousJobs.map((job) => [job.id, job] as const));
  const fresh = listing.jobs.map((job) => {
    const { missedSyncs: _missed, lastMissedAt: _lastMissed, ...rest } = job;
    return { ...rest, firstSeenAt: previousById.get(job.id)?.firstSeenAt ?? job.firstSeenAt ?? now };
  });
  const freshIds = new Set(fresh.map((job) => job.id));
  const notListed = previousJobs.filter(
    (job) => !freshIds.has(job.id) && !listing.listedIds.has(job.id) && isEligible(job)
  );
  // The site stopped at its page limit: these were never read, so not a miss.
  if (listing.incomplete) return [...fresh, ...notListed];
  const stillWaiting: Job[] = [];
  for (const job of notListed) {
    const countsAsMiss = !job.lastMissedAt || now - job.lastMissedAt >= MISS_GAP_MS;
    const missedSyncs = (job.missedSyncs ?? 0) + (countsAsMiss ? 1 : 0);
    if (missedSyncs >= MISSES_BEFORE_CLOSED) continue;
    stillWaiting.push({ ...job, missedSyncs, lastMissedAt: countsAsMiss ? now : job.lastMissedAt });
  }
  return [...fresh, ...stillWaiting];
}
