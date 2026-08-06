import { Analysis, BatchItem, Job } from "./types";
import { APPLIED_JOBS_KEY, loadJSON, saveJSON } from "./persist";

// A job counts as "applied" the moment the user clicks through to the real
// posting from the Apply modal (see goToPosting in app/page.tsx) — no
// separate "mark as applied" step. Stored device-local (localStorage), same
// as the tailored-analysis cache — not synced to Vercel Blob for now.
export interface AppliedJobRecord {
  job: Job;
  analysis?: Analysis;
  appliedAt: number;
}

interface AppliedJobsStore {
  version: number;
  entries: Record<string, AppliedJobRecord>;
}

const STORE_VERSION = 1;

function getStore(): AppliedJobsStore {
  const raw = loadJSON<unknown>(APPLIED_JOBS_KEY, null);
  if (
    raw &&
    typeof raw === "object" &&
    (raw as AppliedJobsStore).version === STORE_VERSION &&
    (raw as AppliedJobsStore).entries &&
    typeof (raw as AppliedJobsStore).entries === "object"
  ) {
    return raw as AppliedJobsStore;
  }
  return { version: STORE_VERSION, entries: {} };
}

// Newest first — that's the order the Applied Jobs list wants.
export function loadAppliedJobs(): AppliedJobRecord[] {
  return Object.values(getStore().entries).sort((a, b) => b.appliedAt - a.appliedAt);
}

// Upserts — re-clicking "Job Post" on an already-applied job keeps the
// original appliedAt instead of bumping it, and refreshes the saved
// analysis in case it was re-tailored since.
export function markJobApplied(item: BatchItem): boolean {
  const store = getStore();
  const existing = store.entries[item.job.id];
  store.entries[item.job.id] = {
    job: item.job,
    analysis: item.analysis,
    appliedAt: existing?.appliedAt ?? Date.now(),
  };
  return saveJSON(APPLIED_JOBS_KEY, store);
}

export function removeAppliedJob(jobId: string): boolean {
  const store = getStore();
  if (!(jobId in store.entries)) return true;
  delete store.entries[jobId];
  return saveJSON(APPLIED_JOBS_KEY, store);
}
