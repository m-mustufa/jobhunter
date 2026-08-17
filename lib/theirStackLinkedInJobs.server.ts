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
import {
  BROAD_MANAGERIAL_TITLE_PATTERN_SOURCES,
  isTargetManagerialTitle,
  NON_MANAGERIAL_TITLE_PATTERN_SOURCES,
  PRIORITY_MANAGERIAL_TITLE_PATTERN_SOURCES,
} from "@/lib/targetRoles";
import {
  GOVERNMENT_GRE_COMPANY_FILTERS,
  compareJobsByEmployerPriority,
  getEmployerPriority,
} from "@/lib/employerPriority";
import { Job } from "@/lib/types";

const THEIRSTACK_SEARCH_URL = "https://api.theirstack.com/v1/jobs/search";
const ABU_DHABI_LOCATION_ID = 292969;
const PAST_MONTH_DAYS = 30;
const DEFAULT_MAX_RESULTS = 150;
const MIN_MAX_RESULTS = 25;
const MAX_CONFIGURED_RESULTS = 250;
const RESULTS_PER_REQUEST = 25;
const MAX_CONCURRENT_REQUESTS = 3;
const REQUEST_BATCH_DELAY_MS = 1_000;
const QUERY_VERSION = 5;
const MAX_EXCLUDED_JOB_IDS = 1_000;
const DISCOVERY_OVERLAP_MS = 5 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 12_000;
// TheirStack charges one credit for every record returned, including records
// returned previously. A live provider sync is therefore allowed at most once
// per 12 hours; normal reads always use the durable saved snapshot.
const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const MAX_DESCRIPTION_CHARS = 18_000;
function configuredMaxResults(): number {
  const parsed = Number.parseInt(process.env.THEIRSTACK_MAX_RESULTS || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RESULTS;
  return Math.min(
    MAX_CONFIGURED_RESULTS,
    Math.max(MIN_MAX_RESULTS, parsed)
  );
}

interface TheirStackJob {
  id?: string | number;
  job_title?: string | null;
  company?: string | null;
  company_name?: string | null;
  company_object?: {
    name?: string | null;
    employee_count?: number | null;
    employee_count_range?: string | null;
    annual_revenue_usd?: number | null;
    annual_revenue_usd_readable?: string | null;
    industry?: string | null;
    is_recruiting_agency?: boolean | null;
    publicly_traded_symbol?: string | null;
    publicly_traded_exchange?: string | null;
  } | null;
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
      return [
        record.name,
        record.value,
        record.location,
        record.city,
        record.region,
        record.state,
        record.admin1_name,
        record.country,
        record.display_name,
      ].filter((candidate): candidate is string => typeof candidate === "string");
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

function isTargetTitle(value: string): boolean {
  return isTargetManagerialTitle(value);
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

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function employeeRange(value: unknown): { min: number | null; max: number | null } {
  const text = cleanInlineText(value);
  if (!text) return { min: null, max: null };
  const numbers = text
    .replace(/,/g, "")
    .match(/\d+/g)
    ?.map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  if (!numbers?.length) return { min: null, max: null };
  return {
    min: numbers[0] ?? null,
    max: /\+\s*$/.test(text) ? null : numbers[1] ?? numbers[0] ?? null,
  };
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
  const exactEmployeeCount = finiteNonNegative(raw.company_object?.employee_count);
  const parsedEmployeeRange = employeeRange(raw.company_object?.employee_count_range);
  const companySizeMin = exactEmployeeCount ?? parsedEmployeeRange.min;
  const companySizeMax = exactEmployeeCount ?? parsedEmployeeRange.max;
  const companyRevenueUsd = finiteNonNegative(raw.company_object?.annual_revenue_usd);
  const companyIndustry = cleanInlineText(raw.company_object?.industry);
  const recruitingAgency = raw.company_object?.is_recruiting_agency;
  const publiclyTraded = Boolean(
    cleanInlineText(raw.company_object?.publicly_traded_symbol) ||
    cleanInlineText(raw.company_object?.publicly_traded_exchange)
  );

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

  const job: Job = {
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
    companySizeMin,
    companySizeMax,
    companyRevenueUsd,
    companyIndustries: companyIndustry ? [companyIndustry] : [],
    companyType: publiclyTraded ? "Public Company" : null,
    companyPubliclyTraded: publiclyTraded ? true : null,
    directEmployer:
      typeof recruitingAgency === "boolean" ? !recruitingAgency : null,
  };
  job.employerTier = getEmployerPriority(job).tier;
  return job;
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

interface TheirStackSearchLane {
  includedTitlePatterns: string[];
  excludedTitlePatterns: string[];
  companyNamePartialMatches?: readonly string[];
  companyNameExactMatches?: readonly string[];
  minEmployeeCount?: number;
  maxEmployeeCountOrNull?: number;
}

async function fetchTheirStackPage(
  key: string,
  page: number,
  limit: number,
  window: TheirStackSearchWindow,
  lane: TheirStackSearchLane
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
        job_title_pattern_or: lane.includedTitlePatterns,
        job_title_pattern_not: lane.excludedTitlePatterns,
        ...(lane.companyNamePartialMatches?.length
          ? {
              company_name_partial_match_or:
                lane.companyNamePartialMatches,
            }
          : {}),
        ...(lane.companyNameExactMatches?.length
          ? {
              company_name_case_insensitive_or:
                lane.companyNameExactMatches,
            }
          : {}),
        ...(typeof lane.minEmployeeCount === "number"
          ? { min_employee_count: lane.minEmployeeCount }
          : {}),
        ...(typeof lane.maxEmployeeCountOrNull === "number"
          ? { max_employee_count_or_null: lane.maxEmployeeCountOrNull }
          : {}),
        url_domain_or: ["linkedin.com"],
        is_closed: false,
        page,
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

interface TheirStackLaneResult {
  rawJobs: TheirStackJob[];
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  firstFailure: unknown;
  windowComplete: boolean;
}

async function loadTheirStackLane(
  key: string,
  window: TheirStackSearchWindow,
  lane: TheirStackSearchLane,
  maxRecords: number
): Promise<TheirStackLaneResult> {
  if (maxRecords <= 0) {
    return {
      rawJobs: [],
      attemptedSearches: 0,
      successfulSearches: 0,
      failedSearches: 0,
      firstFailure: null,
      windowComplete: true,
    };
  }

  // TheirStack's `page` offset is derived from `limit`. Changing the limit on
  // the final page shifts that offset backwards and can return records already
  // fetched by an earlier page. Use one fixed page size for the entire lane,
  // while keeping the lane's maximum requested capacity inside its budget.
  const desiredPageCount = Math.ceil(maxRecords / RESULTS_PER_REQUEST);
  const pageSize = Math.max(
    1,
    Math.min(
      RESULTS_PER_REQUEST,
      Math.floor(maxRecords / desiredPageCount)
    )
  );
  const pageCount = Math.floor(maxRecords / pageSize);
  const requestedCapacity = pageCount * pageSize;
  const pages = Array.from({ length: pageCount }, (_, page) => ({
    page,
    limit: pageSize,
  }));
  const rawJobs: TheirStackJob[] = [];
  let attemptedSearches = 0;
  let successfulSearches = 0;
  let failedSearches = 0;
  let firstFailure: unknown;

  for (let index = 0; index < pages.length; index += MAX_CONCURRENT_REQUESTS) {
    const batch = pages.slice(index, index + MAX_CONCURRENT_REQUESTS);
    attemptedSearches += batch.length;
    const responses = await Promise.allSettled(
      batch.map(({ page, limit }) =>
        fetchTheirStackPage(key, page, limit, window, lane)
      )
    );
    let batchHasShortPage = false;
    let batchFailed = false;
    for (let responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
      const response = responses[responseIndex];
      const requestedLimit = batch[responseIndex].limit;
      if (response.status === "fulfilled") {
        successfulSearches += 1;
        rawJobs.push(...response.value);
        if (response.value.length < requestedLimit) batchHasShortPage = true;
      } else {
        batchFailed = true;
        failedSearches += 1;
        firstFailure ??= response.reason;
      }
    }
    if (batchFailed || batchHasShortPage) break;
    if (index + MAX_CONCURRENT_REQUESTS < pages.length) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_BATCH_DELAY_MS));
    }
  }

  return {
    rawJobs,
    attemptedSearches,
    successfulSearches,
    failedSearches,
    firstFailure,
    windowComplete:
      failedSearches === 0 && rawJobs.length < requestedCapacity,
  };
}

async function loadTheirStackJobs(
  window: TheirStackSearchWindow
): Promise<TheirStackLiveResult> {
  if (process.env.DEMO_MODE === "true") {
    throw new Error("TheirStack is disabled while DEMO_MODE is on");
  }
  const key = process.env.THEIRSTACK_API_KEY;
  if (!key) throw new Error("THEIRSTACK_API_KEY is not configured");

  const maxResults = configuredMaxResults();
  const allManagerialPatterns = [
    ...PRIORITY_MANAGERIAL_TITLE_PATTERN_SOURCES,
    ...BROAD_MANAGERIAL_TITLE_PATTERN_SOURCES,
  ];
  const broadExclusions = [
    ...NON_MANAGERIAL_TITLE_PATTERN_SOURCES,
    ...PRIORITY_MANAGERIAL_TITLE_PATTERN_SOURCES,
  ];
  const rawJobs: TheirStackJob[] = [];
  let attemptedSearches = 0;
  let successfulSearches = 0;
  let failedSearches = 0;
  let firstFailure: unknown = null;
  let allWindowsComplete = true;
  let excludedJobIds = [...window.excludedJobIds];
  let stopAfterAmbiguousFailure = false;

  // Lanes are sequential. Every returned ID is excluded before the next lane
  // starts, so the same record cannot consume credits twice in one sync. Each
  // lane is also capped by the single global maxResults budget.
  const runLane = async (
    lane: TheirStackSearchLane,
    requestedBudget: number
  ): Promise<TheirStackLaneResult> => {
    // A timed-out or otherwise failed TheirStack request may still have used
    // credits. Do not infer remaining credit budget from the records we saw,
    // and do not schedule any later lane after an ambiguous failure.
    if (stopAfterAmbiguousFailure) {
      return {
        rawJobs: [],
        attemptedSearches: 0,
        successfulSearches: 0,
        failedSearches: 0,
        firstFailure: null,
        windowComplete: false,
      };
    }
    const budget = Math.min(
      Math.max(0, requestedBudget),
      Math.max(0, maxResults - rawJobs.length)
    );
    if (budget <= 0) {
      return {
        rawJobs: [],
        attemptedSearches: 0,
        successfulSearches: 0,
        failedSearches: 0,
        firstFailure: null,
        windowComplete: true,
      };
    }
    // Keep provider bursts below three requests per one-second boundary.
    if (attemptedSearches > 0) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_BATCH_DELAY_MS));
    }
    const result = await loadTheirStackLane(
      key,
      { ...window, excludedJobIds },
      lane,
      budget
    );
    rawJobs.push(...result.rawJobs);
    attemptedSearches += result.attemptedSearches;
    successfulSearches += result.successfulSearches;
    failedSearches += result.failedSearches;
    firstFailure ??= result.firstFailure;
    allWindowsComplete = allWindowsComplete && result.windowComplete;
    if (result.failedSearches > 0) stopAfterAmbiguousFailure = true;
    excludedJobIds = mergeSeenJobIds(
      excludedJobIds,
      result.rawJobs
        .map((job) => numericTheirStackId(job.id))
        .filter((id): id is number => id !== null)
    );
    return result;
  };

  // Forty percent is reserved for known Abu Dhabi government/GRE employers.
  // Exact acronym aliases and partial long names are separate requests, which
  // avoids relying on cross-filter OR semantics and makes dedupe explicit.
  const governmentTarget = Math.max(1, Math.ceil(maxResults * 0.4));
  const governmentExactTarget = Math.min(
    governmentTarget,
    Math.max(1, Math.ceil(governmentTarget * 0.25))
  );
  if (GOVERNMENT_GRE_COMPANY_FILTERS.exactNames.length) {
    await runLane(
      {
        includedTitlePatterns: allManagerialPatterns,
        excludedTitlePatterns: NON_MANAGERIAL_TITLE_PATTERN_SOURCES,
        companyNameExactMatches: GOVERNMENT_GRE_COMPANY_FILTERS.exactNames,
      },
      governmentExactTarget
    );
  }
  const governmentUsed = rawJobs.length;
  if (GOVERNMENT_GRE_COMPANY_FILTERS.partialNames.length) {
    await runLane(
      {
        includedTitlePatterns: allManagerialPatterns,
        excludedTitlePatterns: NON_MANAGERIAL_TITLE_PATTERN_SOURCES,
        companyNamePartialMatches: GOVERNMENT_GRE_COMPANY_FILTERS.partialNames,
      },
      Math.max(0, governmentTarget - governmentUsed)
    );
  }

  // Established employers with 201+ employees get the next tranche. Senior
  // titles are drained before generic manager/lead/supervisor aliases.
  const afterGovernment = Math.max(0, maxResults - rawJobs.length);
  const generalReserve = Math.min(
    afterGovernment,
    Math.max(1, Math.ceil(maxResults * 0.15))
  );
  const largeTarget = Math.max(0, afterGovernment - generalReserve);
  const beforeLarge = rawJobs.length;
  await runLane(
    {
      includedTitlePatterns: PRIORITY_MANAGERIAL_TITLE_PATTERN_SOURCES,
      excludedTitlePatterns: NON_MANAGERIAL_TITLE_PATTERN_SOURCES,
      minEmployeeCount: 201,
    },
    Math.ceil(largeTarget * 0.75)
  );
  const largePriorityUsed = rawJobs.length - beforeLarge;
  await runLane(
    {
      includedTitlePatterns: BROAD_MANAGERIAL_TITLE_PATTERN_SOURCES,
      excludedTitlePatterns: broadExclusions,
      minEmployeeCount: 201,
    },
    Math.max(0, largeTarget - largePriorityUsed)
  );

  // The remaining budget is a genuine SME/unknown-size fallback rather than a
  // hard large-company filter. This keeps relevant smaller employers visible.
  const generalTarget = Math.max(0, maxResults - rawJobs.length);
  const beforeGeneral = rawJobs.length;
  await runLane(
    {
      includedTitlePatterns: PRIORITY_MANAGERIAL_TITLE_PATTERN_SOURCES,
      excludedTitlePatterns: NON_MANAGERIAL_TITLE_PATTERN_SOURCES,
      maxEmployeeCountOrNull: 200,
    },
    Math.ceil(generalTarget * 0.75)
  );
  const generalPriorityUsed = rawJobs.length - beforeGeneral;
  await runLane(
    {
      includedTitlePatterns: BROAD_MANAGERIAL_TITLE_PATTERN_SOURCES,
      excludedTitlePatterns: broadExclusions,
      maxEmployeeCountOrNull: 200,
    },
    Math.max(0, generalTarget - generalPriorityUsed)
  );

  // TheirStack charges per returned record, not per empty request. All lanes
  // use rate-safe groups of three and intentionally do not retry ambiguous
  // timeouts, which may already have consumed credits.
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
  jobs.sort(compareJobsByEmployerPriority);

  return {
    jobs: jobs.slice(0, maxResults),
    attemptedSearches,
    successfulSearches,
    failedSearches,
    descriptionFailures,
    apiRecordsReturned: rawJobs.length,
    returnedJobIds: mergeSeenJobIds([], returnedJobIds),
    // Advance the watermark only after every bounded lane is fully drained.
    // Otherwise the next eligible sync continues the same frozen window with
    // every already-returned ID excluded.
    windowComplete: allWindowsComplete,
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
  return {
    version: 1,
    queryVersion: QUERY_VERSION,
    lastAttemptAt: persisted?.lastAttemptAt ?? snapshotLastAttempt,
    // A missing or older query-state version must rebuild the current 30-day
    // window. Previously completed watermarks cannot prove that newly added
    // title aliases and regex patterns were searched.
    lastSuccessfulSyncAt: null,
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
    // Re-rank legacy snapshots immediately; name aliases cover records saved
    // before firmographic metadata was persisted.
    jobs: [...snapshot.jobs].sort(compareJobsByEmployerPriority),
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
      // Re-rank after the persistent upsert as well. Otherwise old snapshots
      // keep insertion order and can bury newly classified major employers.
      jobs: [...mergeResult.jobs].sort(compareJobsByEmployerPriority),
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
