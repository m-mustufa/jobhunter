import "server-only";

import { del, get, put } from "@vercel/blob";
import { Job } from "@/lib/types";

export type JobListingProvider = "hirebase" | "theirstack";

export interface JobListingSnapshot {
  version: 1;
  provider: JobListingProvider;
  savedAt: number;
  jobs: Job[];
  metadata: Record<string, number | null>;
}

export interface TheirStackSyncState {
  version: 1;
  queryVersion: number;
  lastAttemptAt: number | null;
  lastSuccessfulSyncAt: number | null;
  seenJobIds: number[];
}

const PATHS: Record<JobListingProvider, string> = {
  hirebase: "jobhunter/jobs/hirebase.json",
  theirstack: "jobhunter/jobs/theirstack.json",
};
const THEIRSTACK_SYNC_STATE_PATH = "jobhunter/jobs/theirstack-sync-state.json";
const MAX_SYNC_STATE_JOB_IDS = 1_000;

function normalizedApplyLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|trk$|trackingId$|refId$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "") || null;
  }
}

export interface MergeJobListingsResult {
  jobs: Job[];
  newJobsCount: number;
}

/**
 * A provider refresh is an upsert, never a replacement. Truly new jobs are
 * prepended in provider order; matched jobs are updated in place, and jobs no
 * longer present in the bounded response remain available in pagination until
 * the user explicitly clears the listing store.
 */
export function mergeJobListings(
  existing: Job[],
  incoming: Job[]
): MergeJobListingsResult {
  const existingById = new Map<string, Job>();
  const existingByLink = new Map<string, Job>();
  for (const job of existing) {
    existingById.set(job.id.trim().toLowerCase(), job);
    const link = normalizedApplyLink(job.applyLink);
    if (link && !existingByLink.has(link)) existingByLink.set(link, job);
  }

  const newJobs: Job[] = [];
  const updates = new Map<string, Job>();
  const seenIncomingIds = new Set<string>();
  const seenIncomingLinks = new Set<string>();
  for (const job of incoming) {
    const incomingId = job.id.trim().toLowerCase();
    const incomingLink = normalizedApplyLink(job.applyLink);
    if (
      seenIncomingIds.has(incomingId) ||
      (incomingLink && seenIncomingLinks.has(incomingLink))
    ) {
      continue;
    }
    seenIncomingIds.add(incomingId);
    if (incomingLink) seenIncomingLinks.add(incomingLink);

    const matched = existingById.get(incomingId) ||
      (incomingLink ? existingByLink.get(incomingLink) : undefined);
    if (matched) {
      // Keep the original ID even if the provider changed its ID for the
      // same application URL; tailored-analysis references use that ID.
      updates.set(matched.id, { ...matched, ...job, id: matched.id });
    } else {
      newJobs.push(job);
    }
  }

  const merged: Job[] = [...newJobs];
  const emittedIds = new Set(newJobs.map((job) => job.id.trim().toLowerCase()));
  const emittedLinks = new Set(
    newJobs
      .map((job) => normalizedApplyLink(job.applyLink))
      .filter((link): link is string => Boolean(link))
  );
  for (const oldJob of existing) {
    const job = updates.get(oldJob.id) || oldJob;
    const id = job.id.trim().toLowerCase();
    const link = normalizedApplyLink(job.applyLink);
    if (emittedIds.has(id) || (link && emittedLinks.has(link))) continue;
    emittedIds.add(id);
    if (link) emittedLinks.add(link);
    merged.push(job);
  }

  return { jobs: merged, newJobsCount: newJobs.length };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isJob(value: unknown): value is Job {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Partial<Job>;
  return Boolean(
    typeof job.id === "string" &&
      job.id &&
      typeof job.title === "string" &&
      job.title &&
      typeof job.company === "string" &&
      job.company &&
      typeof job.location === "string" &&
      job.location &&
      typeof job.description === "string" &&
      job.description &&
      isNullableString(job.salary) &&
      isNullableString(job.applyLink) &&
      isNullableString(job.source) &&
      isNullableString(job.postedAt)
  );
}

function isMetadata(value: unknown): value is Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) => entry === null || (typeof entry === "number" && Number.isFinite(entry))
  );
}

function isNullableTimestamp(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value > 0)
  );
}

function isTheirStackSyncState(value: unknown): value is TheirStackSyncState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<TheirStackSyncState>;
  return Boolean(
    state.version === 1 &&
      typeof state.queryVersion === "number" &&
      Number.isSafeInteger(state.queryVersion) &&
      state.queryVersion > 0 &&
      isNullableTimestamp(state.lastAttemptAt) &&
      isNullableTimestamp(state.lastSuccessfulSyncAt) &&
      Array.isArray(state.seenJobIds) &&
      state.seenJobIds.length <= MAX_SYNC_STATE_JOB_IDS &&
      state.seenJobIds.every(
        (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0
      )
  );
}

function isSnapshot(
  value: unknown,
  provider: JobListingProvider
): value is JobListingSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<JobListingSnapshot>;
  return Boolean(
    snapshot.version === 1 &&
      snapshot.provider === provider &&
      typeof snapshot.savedAt === "number" &&
      Number.isFinite(snapshot.savedAt) &&
      snapshot.savedAt > 0 &&
      Array.isArray(snapshot.jobs) &&
      snapshot.jobs.length > 0 &&
      snapshot.jobs.every(isJob) &&
      isMetadata(snapshot.metadata)
  );
}

export async function loadJobListingSnapshot(
  provider: JobListingProvider,
  options: { strict?: boolean } = {}
): Promise<JobListingSnapshot | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const result = await get(PATHS[provider], {
      access: "private",
      token,
      useCache: false,
    });
    if (!result?.stream) return null;
    const text = await new Response(result.stream as any).text();
    const parsed = JSON.parse(text) as unknown;
    if (isSnapshot(parsed, provider)) return parsed;
    if (options.strict) {
      throw new Error(`The saved ${provider} listing snapshot is invalid`);
    }
    return null;
  } catch (error) {
    if (options.strict) {
      console.error(`loadJobListingSnapshot: failed to load ${provider}`, error);
      throw new Error(
        `Saved ${provider} listings could not be loaded; no provider request was made`
      );
    }
    // First run, unavailable storage, or a malformed snapshot: the provider
    // adapter will try its live API and retain the browser fallback behavior.
    return null;
  }
}

export async function saveJobListingSnapshot(
  provider: JobListingProvider,
  jobs: Job[],
  metadata: Record<string, number | null>
): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || jobs.length === 0) return false;

  const snapshot: JobListingSnapshot = {
    version: 1,
    provider,
    savedAt: Date.now(),
    jobs,
    metadata,
  };
  try {
    await put(PATHS[provider], JSON.stringify(snapshot), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
    return true;
  } catch (error) {
    console.error(`saveJobListingSnapshot: failed to persist ${provider}`, error);
    return false;
  }
}

export async function loadTheirStackSyncState(
  options: { strict?: boolean } = {}
): Promise<TheirStackSyncState | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const result = await get(THEIRSTACK_SYNC_STATE_PATH, {
      access: "private",
      token,
      useCache: false,
    });
    if (!result?.stream) return null;
    const text = await new Response(result.stream as any).text();
    const parsed = JSON.parse(text) as unknown;
    if (isTheirStackSyncState(parsed)) return parsed;
    if (options.strict) throw new Error("The saved TheirStack sync state is invalid");
    return null;
  } catch (error) {
    if (options.strict) {
      console.error("loadTheirStackSyncState: failed to load sync state", error);
      throw new Error(
        "TheirStack sync state could not be loaded; no provider request was made"
      );
    }
    return null;
  }
}

export async function saveTheirStackSyncState(
  state: TheirStackSyncState
): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || !isTheirStackSyncState(state)) return false;
  try {
    await put(THEIRSTACK_SYNC_STATE_PATH, JSON.stringify(state), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
    return true;
  } catch (error) {
    console.error("saveTheirStackSyncState: failed to persist sync state", error);
    return false;
  }
}

export async function clearJobListingSnapshots(): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  await del(Object.values(PATHS), { token });
}
