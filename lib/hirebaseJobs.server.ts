import "server-only";

import { load } from "cheerio";
import {
  JobListingSnapshot,
  loadJobListingSnapshot,
  mergeJobListings,
  saveJobListingSnapshot,
} from "@/lib/jobListingStore.server";
import {
  isTargetManagerialTitle,
  PROVIDER_SEARCH_TITLES,
} from "@/lib/targetRoles";
import { Job } from "@/lib/types";

const HIREBASE_SEARCH_URL = "https://api.hirebase.org/v2/jobs/search";
const PAST_MONTH_DAYS = 30;

function boundedIntegerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

// These defaults broaden coverage while keeping each refresh inside a
// predictable returned-job budget. They can be tuned for the active Hirebase
// plan without a code deployment.
const MAX_RESULTS = boundedIntegerEnv("HIREBASE_MAX_RESULTS", 250, 70, 1_000);
const RESULTS_PER_PAGE = boundedIntegerEnv(
  "HIREBASE_RESULTS_PER_PAGE",
  20,
  1,
  100
);
const MAX_PAGES_PER_GROUP = boundedIntegerEnv(
  "HIREBASE_MAX_PAGES_PER_GROUP",
  2,
  1,
  5
);
const SYNC_JOB_BUDGET = boundedIntegerEnv(
  "HIREBASE_SYNC_JOB_BUDGET",
  250,
  100,
  2_000
);
const TITLES_PER_QUERY = boundedIntegerEnv(
  "HIREBASE_TITLES_PER_QUERY",
  20,
  5,
  50
);
// A very small titles-per-query override must not create more first-page
// groups than the total returned-record budget can cover. Widen groups when
// necessary so every title family still gets searched without overspending.
const EFFECTIVE_TITLES_PER_QUERY = Math.max(
  TITLES_PER_QUERY,
  Math.ceil(PROVIDER_SEARCH_TITLES.length / SYNC_JOB_BUDGET)
);
// Keep one request slot free for the lazy Company Search page. Hirebase caps
// search endpoints at four requests per second, and a user can open Employers
// while a job refresh is still winding down on the server.
const REQUESTS_PER_BATCH = 3;
const BATCH_INTERVAL_MS = 1_050;
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const STALE_RETRY_TTL_MS = 5 * 60 * 1_000;
const MAX_DESCRIPTION_CHARS = 18_000;
const HIREBASE_TITLE_GROUPS: string[][] = [];
for (
  let index = 0;
  index < PROVIDER_SEARCH_TITLES.length;
  index += EFFECTIVE_TITLES_PER_QUERY
) {
  HIREBASE_TITLE_GROUPS.push(
    PROVIDER_SEARCH_TITLES.slice(
      index,
      index + EFFECTIVE_TITLES_PER_QUERY
    ).map((title) =>
      title === "Governance, Risk and Compliance Manager"
        ? "Governance Risk and Compliance Manager"
        : title
    )
  );
}

interface HirebaseLocation {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  address?: string | null;
}

interface HirebaseSalary {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  period?: string | null;
}

interface HirebaseJob {
  _id?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  job_title_raw?: string | null;
  description?: string | null;
  description_raw?: string | null;
  requirements_summary?: string | null;
  application_link?: string | null;
  job_board_link?: string | null;
  location_raw?: string | null;
  locations?: HirebaseLocation[] | null;
  salary_range?: HirebaseSalary | null;
  date_posted?: string | null;
  job_board?: string | null;
  expired?: boolean | string | null;
}

interface HirebaseResponse {
  jobs?: HirebaseJob[];
  total_count?: number;
  page?: number;
  limit?: number;
  total_pages?: number;
}

type HirebaseRejectionReason =
  | "missingCore"
  | "expired"
  | "outsideAbuDhabi"
  | "nonTargetTitle";

interface HirebaseCoverage {
  providerRecordsReturned: number;
  acceptedJobsCount: number;
  duplicateJobsCount: number;
  rejectedMissingCoreCount: number;
  rejectedExpiredCount: number;
  rejectedLocationCount: number;
  rejectedTitleCount: number;
  attemptedRequests: number;
  successfulRequests: number;
  failedRequests: number;
  partialSearches: number;
}

export interface HirebaseJobsResult {
  jobs: Job[];
  upstreamTotal: number | null;
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  fetchedJobsCount?: number;
  newJobsCount?: number;
  providerRecordsReturned?: number;
  acceptedJobsCount?: number;
  duplicateJobsCount?: number;
  rejectedMissingCoreCount?: number;
  rejectedExpiredCount?: number;
  rejectedLocationCount?: number;
  rejectedTitleCount?: number;
  attemptedRequests?: number;
  successfulRequests?: number;
  failedRequests?: number;
  partialSearches?: number;
  fromCache: boolean;
  stale: boolean;
}

interface HirebaseCacheEntry {
  expiresAt: number;
  result: Omit<HirebaseJobsResult, "fromCache" | "stale">;
  stale: boolean;
}

let hirebaseCache: HirebaseCacheEntry | null = null;
let hirebaseRequest: Promise<HirebaseJobsResult> | null = null;
let hirebaseCacheGeneration = 0;

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

function isTargetTitle(value: string): boolean {
  return isTargetManagerialTitle(value);
}

function locationParts(job: HirebaseJob): string[] {
  const parts = [cleanInlineText(job.location_raw)];
  for (const location of job.locations || []) {
    parts.push(
      cleanInlineText(location.address),
      cleanInlineText(location.city),
      cleanInlineText(location.region),
      cleanInlineText(location.country)
    );
  }
  return parts.filter(Boolean);
}

function isAbuDhabi(job: HirebaseJob): boolean {
  return locationParts(job).join(" ").toLowerCase().includes("abu dhabi");
}

function formatLocation(job: HirebaseJob): string {
  const first = job.locations?.[0];
  const structured = [first?.city, first?.region, first?.country]
    .map(cleanInlineText)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
  return structured || cleanInlineText(first?.address) || cleanInlineText(job.location_raw) || "Abu Dhabi, UAE";
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

function formatSalary(value: HirebaseSalary | null | undefined): string | null {
  if (!value) return null;
  const min = value.min;
  const max = value.max;
  const currency = cleanInlineText(value.currency);
  if (!currency || (typeof min !== "number" && typeof max !== "number")) return null;
  const period = cleanInlineText(value.period);
  const suffix = period ? ` / ${period}` : "";
  const format = (amount: number) => Math.round(amount).toLocaleString("en-US");
  if (typeof min === "number" && typeof max === "number") {
    return `${currency} ${format(min)} - ${format(max)}${suffix}`;
  }
  if (typeof min === "number") return `${currency} ${format(min)}+${suffix}`;
  return `${currency} up to ${format(max as number)}${suffix}`;
}

function isExpired(value: HirebaseJob["expired"]): boolean {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function toJob(raw: HirebaseJob):
  | { job: Job; rejection: null }
  | { job: null; rejection: HirebaseRejectionReason } {
  const id = cleanInlineText(raw._id);
  const title = cleanInlineText(raw.job_title_raw) || cleanInlineText(raw.job_title);
  const company = cleanInlineText(raw.company_name);
  const description =
    cleanDescription(raw.description_raw) ||
    cleanDescription(raw.description) ||
    cleanDescription(raw.requirements_summary);
  const applyLink = normalizeUrl(raw.application_link) || normalizeUrl(raw.job_board_link);

  if (!id || !title || !company || !description || !applyLink) {
    return { job: null, rejection: "missingCore" };
  }
  if (isExpired(raw.expired)) return { job: null, rejection: "expired" };
  // Provider geo search uses its recommended automatic mode for recall, but
  // this local validation remains strict so UAE-wide jobs cannot leak in.
  if (!isAbuDhabi(raw)) return { job: null, rejection: "outsideAbuDhabi" };
  if (!isTargetTitle(title)) return { job: null, rejection: "nonTargetTitle" };

  return {
    job: {
      id: `hirebase-${id}`,
      title,
      company,
      location: formatLocation(raw),
      salary: formatSalary(raw.salary_range),
      description,
      applyLink,
      source: cleanInlineText(raw.job_board)
        ? `${cleanInlineText(raw.job_board)} via Hirebase`
        : "Hirebase",
      postedAt: cleanInlineText(raw.date_posted) || null,
    },
    rejection: null,
  };
}

function postedTimestamp(job: Job): number {
  if (!job.postedAt) return 0;
  const parsed = Date.parse(job.postedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function upstreamError(status: number): Error {
  if (status === 401 || status === 403) return new Error("Hirebase rejected the API key");
  if (status === 422) return new Error("Hirebase rejected the job search filters");
  if (status === 429) return new Error("Hirebase rate limit was reached");
  return new Error(`Hirebase responded ${status}`);
}

async function fetchHirebaseGroup(
  key: string,
  jobTitles: string[],
  page: number,
  limit: number
): Promise<HirebaseResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(HIREBASE_SEARCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({
        job_titles: jobTitles,
        geo_locations: [
          {
            city: "Abu Dhabi",
            region: "Abu Dhabi",
            country: "United Arab Emirates",
          },
        ],
        geofilter_params: { mode: "auto", radius: 50, unit: "km" },
        days_ago: PAST_MONTH_DAYS,
        include_expired: "false",
        return_raw_description: "true",
        sort_by: "date_posted",
        sort_order: "desc",
        page,
        limit,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw upstreamError(response.status);
    const payload = (await response.json()) as HirebaseResponse;
    if (!Array.isArray(payload.jobs)) throw new Error("Hirebase returned an invalid response");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadHirebaseJobs(): Promise<
  Omit<HirebaseJobsResult, "fromCache" | "stale">
> {
  if (process.env.DEMO_MODE === "true") {
    throw new Error("Hirebase is disabled while DEMO_MODE is on");
  }
  const key = process.env.HIREBASE_API_KEY;
  if (!key) throw new Error("HIREBASE_API_KEY is not configured");

  interface SearchTask {
    groupIndex: number;
    jobTitles: string[];
    page: number;
    limit: number;
  }

  interface GroupProgress {
    hadSuccess: boolean;
    hadFailure: boolean;
    totalPages: number;
  }

  const rawJobs: HirebaseJob[] = [];
  const coverage: HirebaseCoverage = {
    providerRecordsReturned: 0,
    acceptedJobsCount: 0,
    duplicateJobsCount: 0,
    rejectedMissingCoreCount: 0,
    rejectedExpiredCount: 0,
    rejectedLocationCount: 0,
    rejectedTitleCount: 0,
    attemptedRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    partialSearches: 0,
  };
  const groupProgress: GroupProgress[] = HIREBASE_TITLE_GROUPS.map(() => ({
    hadSuccess: false,
    hadFailure: false,
    totalPages: 1,
  }));
  let upstreamTotal = 0;
  let hasUpstreamTotal = false;
  let firstFailure: unknown;
  let previousBatchStartedAt = 0;
  let consecutiveFailedBatches = 0;
  let stopScheduling = false;

  // Every title group always gets a first-page request. If the taxonomy grows,
  // the per-page size shrinks automatically so one refresh remains inside the
  // configured returned-job budget instead of silently skipping later groups.
  const firstPageLimit = Math.max(
    1,
    Math.min(
      RESULTS_PER_PAGE,
      Math.floor(SYNC_JOB_BUDGET / Math.max(1, HIREBASE_TITLE_GROUPS.length))
    )
  );

  const runTasks = async (tasks: SearchTask[]): Promise<void> => {
    for (let index = 0; index < tasks.length; index += REQUESTS_PER_BATCH) {
      if (stopScheduling) break;
      const elapsed = Date.now() - previousBatchStartedAt;
      if (previousBatchStartedAt && elapsed < BATCH_INTERVAL_MS) {
        await wait(BATCH_INTERVAL_MS - elapsed);
      }
      previousBatchStartedAt = Date.now();

      const batch = tasks.slice(index, index + REQUESTS_PER_BATCH);
      coverage.attemptedRequests += batch.length;
      const responses = await Promise.allSettled(
        batch.map((task) =>
          fetchHirebaseGroup(key, task.jobTitles, task.page, task.limit)
        )
      );

      const entireBatchFailed = responses.every(
        (response) => response.status === "rejected"
      );
      consecutiveFailedBatches = entireBatchFailed
        ? consecutiveFailedBatches + 1
        : 0;

      responses.forEach((response, responseIndex) => {
        const task = batch[responseIndex];
        const progress = groupProgress[task.groupIndex];
        if (response.status === "fulfilled") {
          coverage.successfulRequests += 1;
          progress.hadSuccess = true;
          const jobs = response.value.jobs || [];
          rawJobs.push(...jobs);
          coverage.providerRecordsReturned += jobs.length;

          const responseTotalPages =
            typeof response.value.total_pages === "number"
              ? response.value.total_pages
              : typeof response.value.total_count === "number"
                ? Math.ceil(response.value.total_count / task.limit)
                : jobs.length === task.limit
                  ? task.page + 1
                  : task.page;
          progress.totalPages = Math.max(
            progress.totalPages,
            Math.min(MAX_PAGES_PER_GROUP, responseTotalPages)
          );

          // Count each group's total only once; otherwise pagination inflates
          // the aggregate upstream coverage number.
          if (task.page === 1 && typeof response.value.total_count === "number") {
            upstreamTotal += response.value.total_count;
            hasUpstreamTotal = true;
          }
        } else {
          coverage.failedRequests += 1;
          progress.hadFailure = true;
          firstFailure ??= response.reason;
        }
      });

      // Do not turn a provider outage into minutes of sequential timeouts.
      // Saved results will be used as the stale fallback, while a partially
      // successful refresh still keeps every completed title group.
      if (consecutiveFailedBatches >= 2) {
        stopScheduling = true;
        break;
      }
    }
  };

  await runTasks(
    HIREBASE_TITLE_GROUPS.map((jobTitles, groupIndex) => ({
      groupIndex,
      jobTitles,
      page: 1,
      limit: firstPageLimit,
    }))
  );

  // Fetch additional pages only while the provider-record budget allows it.
  // We intentionally avoid an experience-level filter here: Hirebase can tag
  // managerial roles as Mid, Senior, Executive, or unknown, and filtering that
  // field would suppress valid titles before our local matcher sees them.
  for (let page = 2; page <= MAX_PAGES_PER_GROUP; page += 1) {
    if (stopScheduling) break;
    let remainingBudget = SYNC_JOB_BUDGET - coverage.providerRecordsReturned;
    if (remainingBudget < firstPageLimit) break;

    const followUpTasks: SearchTask[] = [];
    for (let groupIndex = 0; groupIndex < HIREBASE_TITLE_GROUPS.length; groupIndex += 1) {
      const progress = groupProgress[groupIndex];
      if (!progress.hadSuccess || progress.totalPages < page) continue;
      if (remainingBudget < firstPageLimit) break;
      followUpTasks.push({
        groupIndex,
        jobTitles: HIREBASE_TITLE_GROUPS[groupIndex],
        page,
        limit: firstPageLimit,
      });
      remainingBudget -= firstPageLimit;
    }
    if (followUpTasks.length === 0) break;
    await runTasks(followUpTasks);
  }

  const successfulSearches = groupProgress.filter((group) => group.hadSuccess).length;
  const failedSearches = groupProgress.filter((group) => !group.hadSuccess).length;
  coverage.partialSearches = groupProgress.filter(
    (group) => group.hadSuccess && group.hadFailure
  ).length;

  if (successfulSearches === 0) {
    throw firstFailure instanceof Error ? firstFailure : new Error("Hirebase could not be reached");
  }

  const unique = new Map<string, Job>();
  const seenApplyLinks = new Set<string>();
  for (const raw of rawJobs) {
    const result = toJob(raw);
    if (!result.job) {
      if (result.rejection === "missingCore") coverage.rejectedMissingCoreCount += 1;
      else if (result.rejection === "expired") coverage.rejectedExpiredCount += 1;
      else if (result.rejection === "outsideAbuDhabi") coverage.rejectedLocationCount += 1;
      else if (result.rejection === "nonTargetTitle") coverage.rejectedTitleCount += 1;
      continue;
    }
    const applyLinkKey = result.job.applyLink?.trim().toLowerCase() || "";
    if (
      unique.has(result.job.id) ||
      (applyLinkKey && seenApplyLinks.has(applyLinkKey))
    ) {
      coverage.duplicateJobsCount += 1;
      continue;
    }
    unique.set(result.job.id, result.job);
    if (applyLinkKey) seenApplyLinks.add(applyLinkKey);
  }
  coverage.acceptedJobsCount = unique.size;
  const jobs = [...unique.values()]
    .sort((a, b) => postedTimestamp(b) - postedTimestamp(a))
    .slice(0, MAX_RESULTS);

  return {
    jobs,
    upstreamTotal: hasUpstreamTotal ? upstreamTotal : null,
    attemptedSearches: HIREBASE_TITLE_GROUPS.length,
    successfulSearches,
    failedSearches,
    ...coverage,
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

function resultFromSnapshot(
  snapshot: JobListingSnapshot
): Omit<HirebaseJobsResult, "fromCache" | "stale"> {
  return {
    jobs: snapshot.jobs,
    upstreamTotal: metadataNumber(snapshot, "upstreamTotal", null),
    attemptedSearches:
      metadataNumber(snapshot, "attemptedSearches", HIREBASE_TITLE_GROUPS.length) ||
      HIREBASE_TITLE_GROUPS.length,
    successfulSearches: metadataNumber(snapshot, "successfulSearches", 0) || 0,
    failedSearches: metadataNumber(snapshot, "failedSearches", 0) || 0,
    fetchedJobsCount: metadataNumber(snapshot, "fetchedJobsCount", 0) || 0,
    newJobsCount: metadataNumber(snapshot, "newJobsCount", 0) || 0,
    providerRecordsReturned:
      metadataNumber(snapshot, "providerRecordsReturned", 0) || 0,
    acceptedJobsCount: metadataNumber(snapshot, "acceptedJobsCount", 0) || 0,
    duplicateJobsCount: metadataNumber(snapshot, "duplicateJobsCount", 0) || 0,
    rejectedMissingCoreCount:
      metadataNumber(snapshot, "rejectedMissingCoreCount", 0) || 0,
    rejectedExpiredCount:
      metadataNumber(snapshot, "rejectedExpiredCount", 0) || 0,
    rejectedLocationCount:
      metadataNumber(snapshot, "rejectedLocationCount", 0) || 0,
    rejectedTitleCount: metadataNumber(snapshot, "rejectedTitleCount", 0) || 0,
    attemptedRequests: metadataNumber(snapshot, "attemptedRequests", 0) || 0,
    successfulRequests: metadataNumber(snapshot, "successfulRequests", 0) || 0,
    failedRequests: metadataNumber(snapshot, "failedRequests", 0) || 0,
    partialSearches: metadataNumber(snapshot, "partialSearches", 0) || 0,
  };
}

async function loadPersistentOrLiveHirebase(forceRefresh: boolean): Promise<HirebaseJobsResult> {
  const generation = hirebaseCacheGeneration;
  const snapshot = await loadJobListingSnapshot("hirebase");
  const restored = snapshot ? resultFromSnapshot(snapshot) : null;
  const freshUntil = snapshot ? snapshot.savedAt + CACHE_TTL_MS : 0;

  if (
    !forceRefresh &&
    generation === hirebaseCacheGeneration &&
    restored &&
    freshUntil > Date.now()
  ) {
    hirebaseCache = { result: restored, expiresAt: freshUntil, stale: false };
    return { ...restored, fromCache: true, stale: false };
  }

  try {
    const result = await loadHirebaseJobs();
    if (result.jobs.length === 0 && !snapshot) {
      throw new Error("Hirebase returned no usable Abu Dhabi jobs");
    }

    const mergeResult = mergeJobListings(snapshot?.jobs || [], result.jobs);
    const accumulatedResult = {
      ...result,
      jobs: mergeResult.jobs,
      fetchedJobsCount: result.jobs.length,
      newJobsCount: mergeResult.newJobsCount,
    };
    if (generation !== hirebaseCacheGeneration) {
      throw new Error("Saved listings were cleared while the refresh was running");
    }

    hirebaseCache = {
      result: accumulatedResult,
      expiresAt: Date.now() + CACHE_TTL_MS,
      stale: false,
    };
    await saveJobListingSnapshot("hirebase", accumulatedResult.jobs, {
      upstreamTotal: result.upstreamTotal,
      attemptedSearches: result.attemptedSearches,
      successfulSearches: result.successfulSearches,
      failedSearches: result.failedSearches,
      fetchedJobsCount: result.jobs.length,
      newJobsCount: mergeResult.newJobsCount,
      providerRecordsReturned: result.providerRecordsReturned || 0,
      acceptedJobsCount: result.acceptedJobsCount || 0,
      duplicateJobsCount: result.duplicateJobsCount || 0,
      rejectedMissingCoreCount: result.rejectedMissingCoreCount || 0,
      rejectedExpiredCount: result.rejectedExpiredCount || 0,
      rejectedLocationCount: result.rejectedLocationCount || 0,
      rejectedTitleCount: result.rejectedTitleCount || 0,
      attemptedRequests: result.attemptedRequests || 0,
      successfulRequests: result.successfulRequests || 0,
      failedRequests: result.failedRequests || 0,
      partialSearches: result.partialSearches || 0,
    });
    return { ...accumulatedResult, fromCache: false, stale: false };
  } catch (error) {
    if (generation === hirebaseCacheGeneration && restored) {
      hirebaseCache = {
        result: restored,
        expiresAt: Date.now() + STALE_RETRY_TTL_MS,
        stale: true,
      };
      return { ...restored, fromCache: true, stale: true };
    }
    if (generation !== hirebaseCacheGeneration) {
      throw new Error("Saved listings were cleared while the refresh was running");
    }
    throw error;
  }
}

export async function fetchHirebaseJobs(forceRefresh = false): Promise<HirebaseJobsResult> {
  if (!forceRefresh && hirebaseCache && hirebaseCache.expiresAt > Date.now()) {
    return {
      ...hirebaseCache.result,
      fromCache: true,
      stale: hirebaseCache.stale,
    };
  }

  const request = hirebaseRequest || loadPersistentOrLiveHirebase(forceRefresh);
  hirebaseRequest = request;
  try {
    return await request;
  } finally {
    if (hirebaseRequest === request) hirebaseRequest = null;
  }
}

export async function clearHirebaseJobsMemoryCache(): Promise<void> {
  hirebaseCacheGeneration += 1;
  const pendingRequest = hirebaseRequest;
  hirebaseCache = null;
  hirebaseRequest = null;
  if (pendingRequest) await pendingRequest.catch(() => undefined);
  hirebaseCache = null;
}
