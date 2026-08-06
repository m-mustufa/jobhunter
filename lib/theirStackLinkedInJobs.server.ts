import "server-only";

import { load } from "cheerio";
import {
  JobListingSnapshot,
  TheirStackSyncState,
  loadJobListingSnapshot,
  loadTheirStackSyncState,
  mergeJobListings,
  saveJobListingSnapshot,
  saveTheirStackSyncState,
} from "@/lib/jobListingStore.server";
import { TARGET_ROLE_TITLES } from "@/lib/targetRoles";
import { Job } from "@/lib/types";

const THEIRSTACK_SEARCH_URL = "https://api.theirstack.com/v1/jobs/search";
const ABU_DHABI_LOCATION_ID = 292969;
const PAST_MONTH_DAYS = 30;
const MAX_RESULTS = 70;
const RESULTS_PER_REQUEST = 25;
const QUERY_VERSION = 1;
const MAX_EXCLUDED_JOB_IDS = 1_000;
const DISCOVERY_OVERLAP_MS = 5 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 12_000;
// TheirStack charges one credit for every record returned, including records
// returned previously. A live provider sync is therefore allowed at most once
// per 12 hours; normal reads always use the durable saved snapshot.
const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const MAX_DESCRIPTION_CHARS = 18_000;
const THEIRSTACK_ROLE_TITLES = TARGET_ROLE_TITLES.map((title) =>
  title === "Governance, Risk and Compliance Manager"
    ? "Governance Risk and Compliance Manager"
    : title
);

interface TheirStackJob {
  id?: string | number;
  job_title?: string | null;
  company?: string | null;
  company_name?: string | null;
  company_object?: { name?: string | null } | null;
  location?: string | null;
  short_location?: string | null;
  long_location?: string | null;
  locations?: unknown;
  cities?: unknown;
  salary_string?: string | null;
  salary_currency?: string | null;
  min_annual_salary?: number | null;
  max_annual_salary?: number | null;
  description?: string | null;
  source_url?: string | null;
  url?: string | null;
  final_url?: string | null;
  date_posted?: string | null;
  discovered_at?: string | null;
  closed_at?: string | null;
}

interface TheirStackResponse {
  data?: TheirStackJob[];
}

export interface LinkedInJobsResult {
  jobs: Job[];
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  descriptionFailures: number;
  fetchedJobsCount?: number;
  newJobsCount?: number;
  apiRecordsReturned: number | null;
  syncedAt: number | null;
  nextSyncAt: number | null;
  syncMode: "empty" | "saved" | "cooldown" | "live" | "stale";
  fromCache: boolean;
  stale: boolean;
}

interface LinkedInCacheEntry {
  result: Omit<LinkedInJobsResult, "fromCache" | "stale" | "syncMode">;
  stale: boolean;
}

let linkedInCache: LinkedInCacheEntry | null = null;
let linkedInRequest: {
  forceRefresh: boolean;
  promise: Promise<LinkedInJobsResult>;
} | null = null;
let linkedInCacheGeneration = 0;
let linkedInSyncState: TheirStackSyncState | null = null;

function cleanInlineText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cleanDescription(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  let text = value;
  if (/<\/?[a-z][\s\S]*?>/i.test(value)) {
    const $ = load(value);
    $("script, style, noscript").remove();
    $("br").replaceWith("\n");
    $("li").each((_, element) => {
      $(element).prepend("\n- ").append("\n");
    });
    $("p, h1, h2, h3, h4, h5, h6").append("\n");
    text = $.root().text();
  }
  return cleanMultilineText(text).slice(0, MAX_DESCRIPTION_CHARS);
}

function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const candidate = record.name ?? record.value ?? record.location;
      return typeof candidate === "string" ? [candidate] : [];
    }
    return [];
  });
}

function isAbuDhabi(job: TheirStackJob): boolean {
  const haystack = [
    job.location,
    job.short_location,
    job.long_location,
    ...stringValues(job.locations),
    ...stringValues(job.cities),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes("abu dhabi");
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isTargetTitle(value: string): boolean {
  const postingTitle = normalizeTitle(value);
  return THEIRSTACK_ROLE_TITLES.some((title) =>
    postingTitle.includes(normalizeTitle(title))
  );
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isLinkedInUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

function getApplyLink(job: TheirStackJob): string | null {
  const urls = [job.source_url, job.url, job.final_url]
    .map(normalizeUrl)
    .filter((value): value is string => Boolean(value));
  return urls.find(isLinkedInUrl) || urls[0] || null;
}

function formatSalary(job: TheirStackJob): string | null {
  const supplied = cleanInlineText(job.salary_string);
  if (supplied) return supplied;

  const min = job.min_annual_salary;
  const max = job.max_annual_salary;
  if (typeof min !== "number" && typeof max !== "number") return null;
  const currency = cleanInlineText(job.salary_currency);
  if (!currency) return null;
  const format = (value: number) => Math.round(value).toLocaleString("en-US");
  if (typeof min === "number" && typeof max === "number") {
    return `${currency} ${format(min)} - ${format(max)} / year`;
  }
  if (typeof min === "number") return `${currency} ${format(min)}+ / year`;
  return `${currency} up to ${format(max as number)} / year`;
}

function postedTimestamp(job: Job): number {
  if (!job.postedAt) return 0;
  const parsed = Date.parse(job.postedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericTheirStackId(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function savedTheirStackIds(jobs: Job[]): number[] {
  const ids: number[] = [];
  for (const job of jobs) {
    const match = /^theirstack-(\d+)$/.exec(job.id);
    const id = match ? numericTheirStackId(match[1]) : null;
    if (id !== null) ids.push(id);
    if (ids.length >= MAX_EXCLUDED_JOB_IDS) break;
  }
  return ids;
}

function mergeSeenJobIds(current: number[], incoming: number[]): number[] {
  const unique = new Set<number>();
  for (const id of [...incoming, ...current]) {
    if (Number.isSafeInteger(id) && id > 0) unique.add(id);
    if (unique.size >= MAX_EXCLUDED_JOB_IDS) break;
  }
  return [...unique];
}

function toJob(raw: TheirStackJob): Job | null {
  const rawId = raw.id == null ? "" : String(raw.id).trim();
  const title = cleanInlineText(raw.job_title);
  const company =
    cleanInlineText(raw.company) ||
    cleanInlineText(raw.company_name) ||
    cleanInlineText(raw.company_object?.name);
  const location =
    cleanInlineText(raw.location) ||
    cleanInlineText(raw.short_location) ||
    cleanInlineText(raw.long_location) ||
    "Abu Dhabi, UAE";
  const description = cleanDescription(raw.description);
  const applyLink = getApplyLink(raw);

  if (
    !rawId ||
    !title ||
    !company ||
    !description ||
    !applyLink ||
    !isLinkedInUrl(applyLink) ||
    !isAbuDhabi(raw) ||
    !isTargetTitle(title) ||
    cleanInlineText(raw.closed_at)
  ) {
    return null;
  }

  return {
    // Keep this namespace distinct from the old public-crawler IDs. The old
    // `linkedin-*` prefix activates lazy HTML description hydration, while
    // TheirStack already returns the complete description in this response.
    id: `theirstack-${rawId}`,
    title,
    company,
    location,
    salary: formatSalary(raw),
    description,
    applyLink,
    source: "LinkedIn via TheirStack",
    postedAt: cleanInlineText(raw.date_posted) || cleanInlineText(raw.discovered_at) || null,
  };
}

function upstreamError(status: number): Error {
  if (status === 401 || status === 403) return new Error("TheirStack rejected the API key");
  if (status === 402) return new Error("TheirStack credits are exhausted");
  if (status === 422) return new Error("TheirStack rejected the LinkedIn search filters");
  if (status === 429) return new Error("TheirStack rate limit was reached");
  return new Error(`TheirStack responded ${status}`);
}

interface TheirStackSearchWindow {
  discoveredAtGte: string | null;
  discoveredAtLte: string;
  excludedJobIds: number[];
}

async function fetchTheirStackPage(
  key: string,
  offset: number,
  limit: number,
  window: TheirStackSearchWindow
): Promise<TheirStackJob[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(THEIRSTACK_SEARCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        posted_at_max_age_days: PAST_MONTH_DAYS,
        ...(window.discoveredAtGte
          ? { discovered_at_gte: window.discoveredAtGte }
          : {}),
        discovered_at_lte: window.discoveredAtLte,
        ...(window.excludedJobIds.length
          ? { job_id_not: window.excludedJobIds }
          : {}),
        job_location_or: [{ id: ABU_DHABI_LOCATION_ID }],
        job_title_or: THEIRSTACK_ROLE_TITLES,
        url_domain_or: ["linkedin.com"],
        is_closed: false,
        offset,
        limit,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw upstreamError(response.status);
    const payload = (await response.json()) as TheirStackResponse;
    if (!Array.isArray(payload.data)) throw new Error("TheirStack returned an invalid response");
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

interface TheirStackLiveResult {
  jobs: Job[];
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  descriptionFailures: number;
  apiRecordsReturned: number;
  returnedJobIds: number[];
  windowComplete: boolean;
}

async function loadTheirStackJobs(
  window: TheirStackSearchWindow
): Promise<TheirStackLiveResult> {
  if (process.env.DEMO_MODE === "true") {
    throw new Error("TheirStack is disabled while DEMO_MODE is on");
  }
  const key = process.env.THEIRSTACK_API_KEY;
  if (!key) throw new Error("THEIRSTACK_API_KEY is not configured");

  const pages = [
    { offset: 0, limit: RESULTS_PER_REQUEST },
    { offset: RESULTS_PER_REQUEST, limit: RESULTS_PER_REQUEST },
    { offset: RESULTS_PER_REQUEST * 2, limit: MAX_RESULTS - RESULTS_PER_REQUEST * 2 },
  ];
  // Three concurrent calls stay within TheirStack's free-plan request rate.
  // There is deliberately no automatic retry: an ambiguous timeout may have
  // consumed credits even when the response never reached this process.
  const responses = await Promise.allSettled(
    pages.map(({ offset, limit }) => fetchTheirStackPage(key, offset, limit, window))
  );
  const rawJobs: TheirStackJob[] = [];
  let successfulSearches = 0;
  let failedSearches = 0;
  let firstFailure: unknown;
  for (const response of responses) {
    if (response.status === "fulfilled") {
      successfulSearches += 1;
      rawJobs.push(...response.value);
    } else {
      failedSearches += 1;
      firstFailure ??= response.reason;
    }
  }
  if (successfulSearches === 0) {
    throw firstFailure instanceof Error ? firstFailure : new Error("TheirStack could not be reached");
  }

  const uniqueRawJobs = new Map<string, TheirStackJob>();
  const returnedJobIds: number[] = [];
  for (const raw of rawJobs) {
    const id = raw.id == null ? "" : String(raw.id).trim();
    if (id && !uniqueRawJobs.has(id)) uniqueRawJobs.set(id, raw);
    const numericId = numericTheirStackId(raw.id);
    if (numericId !== null) returnedJobIds.push(numericId);
  }

  let descriptionFailures = 0;
  const jobs: Job[] = [];
  for (const raw of uniqueRawJobs.values()) {
    if (!cleanDescription(raw.description)) descriptionFailures += 1;
    const job = toJob(raw);
    if (job) jobs.push(job);
  }
  jobs.sort((a, b) => postedTimestamp(b) - postedTimestamp(a));

  return {
    jobs: jobs.slice(0, MAX_RESULTS),
    attemptedSearches: pages.length,
    successfulSearches,
    failedSearches,
    descriptionFailures,
    apiRecordsReturned: rawJobs.length,
    returnedJobIds: mergeSeenJobIds([], returnedJobIds),
    // A short, fully successful frozen window proves there was no fourth
    // page. If all 70 slots fill, retain the old watermark and continue that
    // same window on the next allowed sync with these IDs excluded.
    windowComplete: failedSearches === 0 && rawJobs.length < MAX_RESULTS,
  };
}

function metadataNumber(
  snapshot: JobListingSnapshot,
  key: string,
  fallback: number | null
): number | null {
  const value = snapshot.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveSyncState(
  snapshot: JobListingSnapshot | null,
  persisted: TheirStackSyncState | null
): TheirStackSyncState {
  if (persisted?.queryVersion === QUERY_VERSION) {
    const snapshotLastAttempt = snapshot
      ? metadataNumber(snapshot, "lastAttemptAt", null)
      : null;
    const snapshotLastSuccess = snapshot
      ? metadataNumber(snapshot, "lastSuccessfulSyncAt", null)
      : null;
    const snapshotIsNewest =
      Boolean(snapshotLastAttempt) &&
      (snapshotLastAttempt || 0) >= (persisted.lastAttemptAt || 0);
    return {
      ...persisted,
      lastAttemptAt: snapshotIsNewest
        ? snapshotLastAttempt
        : persisted.lastAttemptAt,
      lastSuccessfulSyncAt:
        snapshotIsNewest && snapshotLastSuccess
          ? snapshotLastSuccess
          : persisted.lastSuccessfulSyncAt,
      seenJobIds: mergeSeenJobIds(
        persisted.seenJobIds,
        snapshot ? savedTheirStackIds(snapshot.jobs) : []
      ),
    };
  }

  const snapshotLastAttempt = snapshot
    ? metadataNumber(snapshot, "lastAttemptAt", snapshot.savedAt)
    : null;
  const snapshotLastSuccess = snapshot
    ? metadataNumber(snapshot, "lastSuccessfulSyncAt", snapshot.savedAt)
    : null;
  const snapshotRecordCount = snapshot
    ? metadataNumber(
        snapshot,
        "apiRecordsReturned",
        metadataNumber(snapshot, "fetchedJobsCount", snapshot.jobs.length)
      ) ?? snapshot.jobs.length
    : 0;
  const legacyWindowWasComplete = Boolean(
    snapshot && snapshotRecordCount < MAX_RESULTS
  );
  return {
    version: 1,
    queryVersion: QUERY_VERSION,
    lastAttemptAt: persisted?.lastAttemptAt ?? snapshotLastAttempt,
    // A legacy snapshot below the provider cap proves that its result window
    // was drained. A capped snapshot must keep a null watermark and continue
    // the same 30-day window with its IDs excluded on the next allowed sync.
    lastSuccessfulSyncAt:
      !persisted && legacyWindowWasComplete ? snapshotLastSuccess : null,
    seenJobIds: snapshot ? savedTheirStackIds(snapshot.jobs) : [],
  };
}

function resultFromSnapshot(
  snapshot: JobListingSnapshot,
  state: TheirStackSyncState
): LinkedInCacheEntry["result"] {
  const syncedAt =
    metadataNumber(snapshot, "syncedAt", state.lastSuccessfulSyncAt) ??
    snapshot.savedAt;
  return {
    jobs: snapshot.jobs,
    attemptedSearches: metadataNumber(snapshot, "attemptedSearches", 3) ?? 3,
    successfulSearches: metadataNumber(snapshot, "successfulSearches", 0) ?? 0,
    failedSearches: metadataNumber(snapshot, "failedSearches", 0) ?? 0,
    descriptionFailures: metadataNumber(snapshot, "descriptionFailures", 0) ?? 0,
    fetchedJobsCount: metadataNumber(snapshot, "fetchedJobsCount", 0) ?? 0,
    newJobsCount: metadataNumber(snapshot, "newJobsCount", 0) ?? 0,
    apiRecordsReturned: metadataNumber(snapshot, "apiRecordsReturned", 0),
    syncedAt,
    nextSyncAt: state.lastAttemptAt
      ? state.lastAttemptAt + CACHE_TTL_MS
      : null,
  };
}

function emptySavedResult(
  state: TheirStackSyncState
): LinkedInCacheEntry["result"] {
  return {
    jobs: [],
    attemptedSearches: 0,
    successfulSearches: 0,
    failedSearches: 0,
    descriptionFailures: 0,
    fetchedJobsCount: 0,
    newJobsCount: 0,
    apiRecordsReturned: 0,
    syncedAt: state.lastSuccessfulSyncAt,
    nextSyncAt: state.lastAttemptAt
      ? state.lastAttemptAt + CACHE_TTL_MS
      : null,
  };
}

async function persistCreditGuardState(
  state: TheirStackSyncState,
  context: string
): Promise<void> {
  const saved = await saveTheirStackSyncState(state);
  if (process.env.BLOB_READ_WRITE_TOKEN && !saved) {
    throw new Error(
      `TheirStack sync was cancelled because the ${context} credit guard could not be saved`
    );
  }
}

async function loadPersistentOrLiveTheirStack(forceRefresh: boolean): Promise<LinkedInJobsResult> {
  const generation = linkedInCacheGeneration;
  const [snapshot, persistedState] = await Promise.all([
    loadJobListingSnapshot("theirstack", { strict: forceRefresh }),
    loadTheirStackSyncState({ strict: forceRefresh }),
  ]);
  if (generation !== linkedInCacheGeneration) {
    throw new Error("Saved listings were cleared while the refresh was running");
  }

  const newestState =
    linkedInSyncState &&
    (!persistedState ||
      (linkedInSyncState.lastAttemptAt || 0) >=
        (persistedState.lastAttemptAt || 0))
      ? linkedInSyncState
      : persistedState;
  const state = resolveSyncState(snapshot, newestState);
  linkedInSyncState = state;
  const restored = snapshot ? resultFromSnapshot(snapshot, state) : null;
  const now = Date.now();
  const cooldownUntil = state.lastAttemptAt
    ? state.lastAttemptAt + CACHE_TTL_MS
    : 0;

  // Toggling LinkedIn, changing a keyword, and ordinary page loads are saved
  // reads only. They never call TheirStack. A live sync requires the explicit
  // Refresh action below.
  if (!forceRefresh) {
    const saved = restored || emptySavedResult(state);
    linkedInCache = {
      result: saved,
      stale: false,
    };
    return {
      ...saved,
      syncMode: restored
        ? "saved"
        : cooldownUntil > now
          ? "cooldown"
          : "empty",
      fromCache: true,
      stale: false,
    };
  }

  if (cooldownUntil > now) {
    const saved = restored || emptySavedResult(state);
    linkedInCache = {
      result: saved,
      stale: false,
    };
    return {
      ...saved,
      syncMode: "cooldown",
      fromCache: true,
      stale: false,
    };
  }

  // Configuration failures cannot consume provider credits, so fail before
  // recording a paid-attempt cooldown. This lets an operator fix the key and
  // retry immediately.
  if (process.env.DEMO_MODE === "true") {
    throw new Error("TheirStack is disabled while DEMO_MODE is on");
  }
  if (!process.env.THEIRSTACK_API_KEY) {
    throw new Error("THEIRSTACK_API_KEY is not configured");
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is required for restart-safe TheirStack credit protection; no provider request was made"
    );
  }

  const syncStartedAt = Date.now();
  const attemptedState: TheirStackSyncState = {
    ...state,
    lastAttemptAt: syncStartedAt,
  };
  linkedInSyncState = attemptedState;
  // Persist the attempt before contacting TheirStack. Even an ambiguous
  // timeout may have consumed credits, so another click must not immediately
  // repeat the same paid request.
  await persistCreditGuardState(attemptedState, "pre-request");

  try {
    const excludedJobIds = mergeSeenJobIds(
      attemptedState.seenJobIds,
      snapshot ? savedTheirStackIds(snapshot.jobs) : []
    );
    const result = await loadTheirStackJobs({
      discoveredAtGte: attemptedState.lastSuccessfulSyncAt
        ? new Date(
            Math.max(0, attemptedState.lastSuccessfulSyncAt - DISCOVERY_OVERLAP_MS)
          ).toISOString()
        : null,
      discoveredAtLte: new Date(syncStartedAt).toISOString(),
      excludedJobIds,
    });

    const mergeResult = mergeJobListings(snapshot?.jobs || [], result.jobs);
    const lastSuccessfulSyncAt =
      result.windowComplete
        ? syncStartedAt
        : attemptedState.lastSuccessfulSyncAt;
    const nextState: TheirStackSyncState = {
      version: 1,
      queryVersion: QUERY_VERSION,
      lastAttemptAt: syncStartedAt,
      lastSuccessfulSyncAt,
      seenJobIds: mergeSeenJobIds(
        attemptedState.seenJobIds,
        result.returnedJobIds
      ),
    };
    const accumulatedResult = {
      jobs: mergeResult.jobs,
      attemptedSearches: result.attemptedSearches,
      successfulSearches: result.successfulSearches,
      failedSearches: result.failedSearches,
      descriptionFailures: result.descriptionFailures,
      fetchedJobsCount: result.jobs.length,
      newJobsCount: mergeResult.newJobsCount,
      apiRecordsReturned: result.apiRecordsReturned,
      syncedAt: syncStartedAt,
      nextSyncAt: syncStartedAt + CACHE_TTL_MS,
    };
    if (generation !== linkedInCacheGeneration) {
      throw new Error("Saved listings were cleared while the refresh was running");
    }

    if (accumulatedResult.jobs.length > 0) {
      const snapshotSaved = await saveJobListingSnapshot("theirstack", accumulatedResult.jobs, {
        attemptedSearches: result.attemptedSearches,
        successfulSearches: result.successfulSearches,
        failedSearches: result.failedSearches,
        descriptionFailures: result.descriptionFailures,
        fetchedJobsCount: result.jobs.length,
        newJobsCount: mergeResult.newJobsCount,
        apiRecordsReturned: result.apiRecordsReturned,
        syncedAt: syncStartedAt,
        lastAttemptAt: syncStartedAt,
        lastSuccessfulSyncAt,
      });
      if (!snapshotSaved) {
        throw new Error(
          "TheirStack results could not be saved, so the incremental cursor was not advanced"
        );
      }
    }
    // Advance the watermark and exclusion ledger only after the accumulated
    // listing snapshot is durable. Snapshot metadata can recover this state if
    // the separate ledger write is interrupted.
    await persistCreditGuardState(nextState, "post-request");
    linkedInSyncState = nextState;
    linkedInCache = {
      result: accumulatedResult,
      stale: false,
    };
    return {
      ...accumulatedResult,
      syncMode: "live",
      fromCache: false,
      stale: false,
    };
  } catch (error) {
    if (generation !== linkedInCacheGeneration) {
      throw new Error("Saved listings were cleared while the refresh was running");
    }
    if (restored) {
      const staleResult: LinkedInCacheEntry["result"] = {
        ...restored,
        apiRecordsReturned: null,
        nextSyncAt: syncStartedAt + CACHE_TTL_MS,
      };
      linkedInCache = {
        result: staleResult,
        stale: true,
      };
      return {
        ...staleResult,
        syncMode: "stale",
        fromCache: true,
        stale: true,
      };
    }
    throw error;
  }
}

export async function fetchLinkedInJobs(forceRefresh = false): Promise<LinkedInJobsResult> {
  const now = Date.now();
  const cachedCooldownActive = Boolean(
    linkedInCache?.result.nextSyncAt && linkedInCache.result.nextSyncAt > now
  );
  if (linkedInCache && (!forceRefresh || cachedCooldownActive)) {
    const cooldown =
      forceRefresh && cachedCooldownActive;
    return {
      ...linkedInCache.result,
      syncMode: cooldown
        ? "cooldown"
        : linkedInCache.stale
          ? "stale"
          : linkedInCache.result.jobs.length
            ? "saved"
            : "empty",
      fromCache: true,
      stale: linkedInCache.stale,
    };
  }

  if (linkedInRequest) {
    const active = linkedInRequest;
    // Ordinary reads can share a live refresh. A forced refresh must wait for
    // an ordinary saved read to finish and then perform its own cooldown check.
    if (!forceRefresh || active.forceRefresh) return active.promise;
    await active.promise.catch(() => undefined);
  }

  const request = loadPersistentOrLiveTheirStack(forceRefresh);
  linkedInRequest = { forceRefresh, promise: request };
  try {
    return await request;
  } finally {
    if (linkedInRequest?.promise === request) linkedInRequest = null;
  }
}

export async function clearLinkedInJobsMemoryCache(): Promise<void> {
  linkedInCacheGeneration += 1;
  const pendingRequest = linkedInRequest?.promise;
  linkedInCache = null;
  linkedInRequest = null;
  if (pendingRequest) await pendingRequest.catch(() => undefined);
  linkedInCache = null;

  // Clearing listings resets the incremental watermark so the next allowed
  // sync can rebuild the current 30-day set, but it intentionally preserves
  // the last attempt time. This prevents Clear -> Refresh from bypassing the
  // 12-hour credit guard.
  const snapshot = await loadJobListingSnapshot("theirstack", { strict: true });
  const persistedState = await loadTheirStackSyncState({ strict: true });
  const currentState = linkedInSyncState || resolveSyncState(snapshot, persistedState);
  const resetState: TheirStackSyncState = {
    version: 1,
    queryVersion: QUERY_VERSION,
    lastAttemptAt: currentState.lastAttemptAt,
    lastSuccessfulSyncAt: null,
    seenJobIds: [],
  };
  linkedInSyncState = resetState;
  await persistCreditGuardState(resetState, "post-clear");
}
