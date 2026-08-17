import "server-only";

import { load } from "cheerio";
import {
  HirebaseSyncState,
  JobListingSnapshot,
  loadHirebaseSyncState,
  loadJobListingSnapshot,
  mergeJobListings,
  saveHirebaseSyncState,
  saveJobListingSnapshot,
} from "@/lib/jobListingStore.server";
import {
  isTargetManagerialTitle,
  PROVIDER_SEARCH_TITLES,
} from "@/lib/targetRoles";
import {
  compareJobsByEmployerPriority,
  getEmployerPriority,
} from "@/lib/employerPriority";
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
  50,
  5,
  50
);
const MAX_SEARCH_GROUPS_PER_LANE = 24;
const LARGE_COMPANY_TYPES = [
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10000+",
] as const;
const SME_COMPANY_TYPES = ["1-10", "11-50", "51-200"] as const;
const LARGE_COMPANY_BUDGET = Math.floor(SYNC_JOB_BUDGET * 0.6);
const SME_COMPANY_BUDGET = Math.floor(SYNC_JOB_BUDGET * 0.25);
const UNKNOWN_SIZE_FALLBACK_BUDGET = Math.max(
  1,
  SYNC_JOB_BUDGET - LARGE_COMPANY_BUDGET - SME_COMPANY_BUDGET
);
// A very small titles-per-query override must not create more first-page
// groups than the smallest reserved lane can cover. Widen groups when
// necessary so large, SME, and unknown-size lanes all search every title
// family without overspending.
const EFFECTIVE_TITLES_PER_QUERY = Math.max(
  TITLES_PER_QUERY,
  Math.ceil(
    PROVIDER_SEARCH_TITLES.length / MAX_SEARCH_GROUPS_PER_LANE
  ),
  Math.ceil(
    PROVIDER_SEARCH_TITLES.length / UNKNOWN_SIZE_FALLBACK_BUDGET
  )
);
// Keep one request slot free for the lazy Company Search page. Hirebase caps
// search endpoints at four requests per second, and a user can open Employers
// while a job refresh is still winding down on the server.
const REQUESTS_PER_BATCH = 3;
const BATCH_INTERVAL_MS = 1_050;
const FETCH_TIMEOUT_MS = 12_000;
const LIVE_LOAD_DEADLINE_MS = 45_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const STALE_RETRY_TTL_MS = 5 * 60 * 1_000;
const REFRESH_COOLDOWN_MS =
  boundedIntegerEnv("HIREBASE_REFRESH_COOLDOWN_MINUTES", 15, 5, 60) *
  60_000;
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
  recruiter_agency?: boolean | null;
  company_data?: {
    size_range?: {
      min?: number | null;
      max?: number | null;
    } | null;
    industries?: unknown;
    subindustries?: unknown;
    type?: string | null;
    is_recruiting_agency?: boolean | null;
    is_3rd_party_agency?: boolean | null;
    annual_revenue_usd?: number | null;
    revenue_usd?: number | null;
  } | null;
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
  syncedAt: number | null;
  nextSyncAt: number | null;
  syncMode: "empty" | "saved" | "cooldown" | "live" | "stale";
  fromCache: boolean;
  stale: boolean;
}

type HirebaseLiveResult = Omit<
  HirebaseJobsResult,
  "fromCache" | "stale" | "syncMode" | "syncedAt" | "nextSyncAt"
>;

type HirebaseStoredResult = Omit<
  HirebaseJobsResult,
  "fromCache" | "stale" | "syncMode"
>;

interface HirebaseCacheEntry {
  expiresAt: number;
  result: HirebaseStoredResult;
  stale: boolean;
  syncMode: "empty" | "saved" | "cooldown" | "stale";
}

let hirebaseCache: HirebaseCacheEntry | null = null;
let hirebaseRequest: Promise<HirebaseJobsResult> | null = null;
let hirebaseCacheGeneration = 0;
let hirebaseLastAttemptAt: number | null = null;

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

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanInlineText).filter(Boolean))].slice(0, 12);
}

function directEmployer(job: HirebaseJob): boolean | null {
  const agencyFlags = [
    job.recruiter_agency,
    job.company_data?.is_recruiting_agency,
    job.company_data?.is_3rd_party_agency,
  ].filter((value): value is boolean => typeof value === "boolean");
  if (agencyFlags.some(Boolean)) return false;
  if (agencyFlags.length > 0) return true;
  return null;
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

  const companyIndustries = [
    ...cleanStringList(raw.company_data?.industries),
    ...cleanStringList(raw.company_data?.subindustries),
  ];
  const companyType = cleanInlineText(raw.company_data?.type) || null;
  const companySizeMin = finiteNonNegative(raw.company_data?.size_range?.min);
  const companySizeMax = finiteNonNegative(raw.company_data?.size_range?.max);
  const companyRevenueUsd =
    finiteNonNegative(raw.company_data?.annual_revenue_usd) ??
    finiteNonNegative(raw.company_data?.revenue_usd);
  const job: Job = {
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
    companySizeMin,
    companySizeMax,
    companyRevenueUsd,
    companyIndustries: [...new Set(companyIndustries)],
    companyType,
    companyPubliclyTraded:
      companyType && /\bpublic(?:ly)?(?:\s+traded)?\b/i.test(companyType)
        ? true
        : null,
    directEmployer: directEmployer(raw),
  };
  job.employerTier = getEmployerPriority(job).tier;
  return {
    job,
    rejection: null,
  };
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
  limit: number,
  companyTypes?: readonly string[],
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<HirebaseResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(FETCH_TIMEOUT_MS, timeoutMs))
  );
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
        ...(companyTypes?.length ? { company_types: companyTypes } : {}),
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

async function loadHirebaseJobs(): Promise<HirebaseLiveResult> {
  if (process.env.DEMO_MODE === "true") {
    throw new Error("Hirebase is disabled while DEMO_MODE is on");
  }
  const key = process.env.HIREBASE_API_KEY;
  if (!key) throw new Error("HIREBASE_API_KEY is not configured");

  interface SearchTask {
    progressIndex: number;
    jobTitles: string[];
    page: number;
    limit: number;
    companyTypes?: readonly string[];
    countTowardUpstreamTotal: boolean;
  }

  interface GroupProgress {
    attempted: boolean;
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
  const laneDefinitions = [
    { companyTypes: LARGE_COMPANY_TYPES, countTowardUpstreamTotal: false },
    { companyTypes: SME_COMPANY_TYPES, countTowardUpstreamTotal: false },
    // Hirebase can omit company size metadata. Keep a deliberately smaller
    // unfiltered lane after the explicit large and SME reservations so those
    // unknown-size vacancies remain eligible without consuming SME capacity.
    { companyTypes: undefined, countTowardUpstreamTotal: true },
  ] as const;
  const groupProgress: GroupProgress[] = laneDefinitions.flatMap(() =>
    HIREBASE_TITLE_GROUPS.map(() => ({
      attempted: false,
      hadSuccess: false,
      hadFailure: false,
      totalPages: 1,
    }))
  );
  let upstreamTotal = 0;
  let hasUpstreamTotal = false;
  let firstFailure: unknown;
  let previousBatchStartedAt = 0;
  let batchesWithFailure = 0;
  let stopScheduling = false;
  const liveLoadStartedAt = Date.now();

  const runTasks = async (tasks: SearchTask[]): Promise<void> => {
    for (let index = 0; index < tasks.length; index += REQUESTS_PER_BATCH) {
      if (
        stopScheduling ||
        Date.now() - liveLoadStartedAt >= LIVE_LOAD_DEADLINE_MS
      ) {
        stopScheduling = true;
        break;
      }
      const elapsed = Date.now() - previousBatchStartedAt;
      if (previousBatchStartedAt && elapsed < BATCH_INTERVAL_MS) {
        await wait(BATCH_INTERVAL_MS - elapsed);
      }
      const remainingLiveMs =
        LIVE_LOAD_DEADLINE_MS - (Date.now() - liveLoadStartedAt);
      if (remainingLiveMs <= 0) {
        stopScheduling = true;
        break;
      }
      previousBatchStartedAt = Date.now();

      const batch = tasks.slice(index, index + REQUESTS_PER_BATCH);
      coverage.attemptedRequests += batch.length;
      batch.forEach((task) => {
        groupProgress[task.progressIndex].attempted = true;
      });
      const responses = await Promise.allSettled(
        batch.map((task) =>
          fetchHirebaseGroup(
            key,
            task.jobTitles,
            task.page,
            task.limit,
            task.companyTypes,
            remainingLiveMs
          )
        )
      );

      const batchHasFailure = responses.some(
        (response) => response.status === "rejected"
      );
      if (batchHasFailure) batchesWithFailure += 1;

      responses.forEach((response, responseIndex) => {
        const task = batch[responseIndex];
        const progress = groupProgress[task.progressIndex];
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
          if (
            task.countTowardUpstreamTotal &&
            task.page === 1 &&
            typeof response.value.total_count === "number"
          ) {
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
      if (
        batchesWithFailure >= 2 ||
        Date.now() - liveLoadStartedAt >= LIVE_LOAD_DEADLINE_MS
      ) {
        stopScheduling = true;
        break;
      }
    }
  };

  const runCompanySizeLane = async (
    laneIndex: number,
    laneBudget: number
  ): Promise<void> => {
    const lane = laneDefinitions[laneIndex];
    const laneStartRecords = coverage.providerRecordsReturned;
    const firstPageLimit = Math.max(
      1,
      Math.min(
        RESULTS_PER_PAGE,
        Math.floor(laneBudget / Math.max(1, HIREBASE_TITLE_GROUPS.length))
      )
    );
    if (stopScheduling || laneBudget <= 0) return;
    await runTasks(
      HIREBASE_TITLE_GROUPS.map((jobTitles, groupIndex) => ({
        progressIndex: laneIndex * HIREBASE_TITLE_GROUPS.length + groupIndex,
        jobTitles,
        page: 1,
        limit: firstPageLimit,
        companyTypes: lane.companyTypes,
        countTowardUpstreamTotal: lane.countTowardUpstreamTotal,
      }))
    );

    // Fetch additional pages only while this lane's provider-record budget
    // allows it. Experience level stays unfiltered because valid managerial
    // roles can be tagged Mid, Senior, Executive, or unknown by Hirebase.
    for (let page = 2; page <= MAX_PAGES_PER_GROUP; page += 1) {
      if (stopScheduling) break;
      let remainingBudget =
        laneBudget - (coverage.providerRecordsReturned - laneStartRecords);
      if (remainingBudget < firstPageLimit) break;

      const followUpTasks: SearchTask[] = [];
      for (let groupIndex = 0; groupIndex < HIREBASE_TITLE_GROUPS.length; groupIndex += 1) {
        const progressIndex = laneIndex * HIREBASE_TITLE_GROUPS.length + groupIndex;
        const progress = groupProgress[progressIndex];
        if (!progress.hadSuccess || progress.totalPages < page) continue;
        if (remainingBudget < firstPageLimit) break;
        followUpTasks.push({
          progressIndex,
          jobTitles: HIREBASE_TITLE_GROUPS[groupIndex],
          page,
          // Keep page size constant for this lane. Changing it on a later page
          // can shift a page-based offset backwards and return duplicates.
          limit: firstPageLimit,
          companyTypes: lane.companyTypes,
          countTowardUpstreamTotal: lane.countTowardUpstreamTotal,
        });
        remainingBudget -= firstPageLimit;
      }
      if (followUpTasks.length === 0) break;
      await runTasks(followUpTasks);
    }
  };

  // Large employers run first, but explicit SME/recruiter capacity and a
  // smaller unknown-size fallback are reserved before any request starts.
  // Unused large capacity may flow into the SME lane; unused capacity from
  // either filtered lane may flow into the final fallback. The sum of returned
  // records can never exceed the one global refresh budget.
  const beforeLarge = coverage.providerRecordsReturned;
  await runCompanySizeLane(0, LARGE_COMPANY_BUDGET);
  const largeUsed = coverage.providerRecordsReturned - beforeLarge;
  const smeBudget = Math.min(
    SME_COMPANY_BUDGET + Math.max(0, LARGE_COMPANY_BUDGET - largeUsed),
    Math.max(
      0,
      SYNC_JOB_BUDGET -
        coverage.providerRecordsReturned -
        UNKNOWN_SIZE_FALLBACK_BUDGET
    )
  );
  await runCompanySizeLane(1, smeBudget);
  await runCompanySizeLane(
    2,
    Math.max(0, SYNC_JOB_BUDGET - coverage.providerRecordsReturned)
  );

  const attemptedSearches = groupProgress.filter((group) => group.attempted).length;
  const successfulSearches = groupProgress.filter(
    (group) => group.attempted && group.hadSuccess
  ).length;
  const failedSearches = groupProgress.filter(
    (group) => group.attempted && group.hadFailure
  ).length;
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
    .sort(compareJobsByEmployerPriority)
    .slice(0, MAX_RESULTS);

  return {
    jobs,
    upstreamTotal: hasUpstreamTotal ? upstreamTotal : null,
    attemptedSearches,
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
  snapshot: JobListingSnapshot,
  state: HirebaseSyncState
): HirebaseStoredResult {
  return {
    // Old snapshots do not need a migration: canonical company-name aliases
    // classify and rank them even when provider firmographics are absent.
    jobs: [...snapshot.jobs].sort(compareJobsByEmployerPriority),
    upstreamTotal: metadataNumber(snapshot, "upstreamTotal", null),
    attemptedSearches:
      metadataNumber(snapshot, "attemptedSearches", 0) || 0,
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
    syncedAt: metadataNumber(snapshot, "syncedAt", snapshot.savedAt),
    nextSyncAt: state.lastAttemptAt
      ? state.lastAttemptAt + REFRESH_COOLDOWN_MS
      : null,
  };
}

function emptySavedResult(state: HirebaseSyncState): HirebaseStoredResult {
  return {
    jobs: [],
    upstreamTotal: null,
    attemptedSearches: 0,
    successfulSearches: 0,
    failedSearches: 0,
    fetchedJobsCount: 0,
    newJobsCount: 0,
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
    syncedAt: null,
    nextSyncAt: state.lastAttemptAt
      ? state.lastAttemptAt + REFRESH_COOLDOWN_MS
      : null,
  };
}

async function persistHirebaseAttemptState(
  state: HirebaseSyncState
): Promise<void> {
  const saved = await saveHirebaseSyncState(state);
  if (process.env.BLOB_READ_WRITE_TOKEN && !saved) {
    throw new Error(
      "Hirebase refresh was cancelled because its pre-request cooldown could not be saved; no provider request was made"
    );
  }
}

async function loadPersistentOrLiveHirebase(forceRefresh: boolean): Promise<HirebaseJobsResult> {
  const generation = hirebaseCacheGeneration;
  const durableStorageConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const [snapshot, persistedState] = await Promise.all([
    loadJobListingSnapshot("hirebase", {
      strict: durableStorageConfigured,
    }),
    loadHirebaseSyncState({ strict: durableStorageConfigured }),
  ]);
  if (generation !== hirebaseCacheGeneration) {
    throw new Error("Saved listings were cleared while the refresh was running");
  }

  const latestAttemptAt = Math.max(
    hirebaseLastAttemptAt || 0,
    persistedState?.lastAttemptAt || 0
  );
  const state: HirebaseSyncState = {
    version: 1,
    lastAttemptAt: latestAttemptAt > 0 ? latestAttemptAt : null,
  };
  hirebaseLastAttemptAt = state.lastAttemptAt;
  const restored = snapshot ? resultFromSnapshot(snapshot, state) : null;
  const freshUntil = snapshot ? snapshot.savedAt + CACHE_TTL_MS : 0;
  const now = Date.now();
  const cooldownUntil = state.lastAttemptAt
    ? state.lastAttemptAt + REFRESH_COOLDOWN_MS
    : 0;

  // Ordinary searches are saved reads. Once a snapshot exists, only the
  // explicit Refresh action may contact Hirebase again.
  if (!forceRefresh && generation === hirebaseCacheGeneration && restored) {
    hirebaseCache = {
      result: restored,
      expiresAt: Math.max(freshUntil, now + CACHE_TTL_MS),
      stale: false,
      syncMode: "saved",
    };
    return {
      ...restored,
      syncMode: "saved",
      fromCache: true,
      stale: false,
    };
  }

  if (!forceRefresh && !restored) {
    const empty = emptySavedResult(state);
    hirebaseCache = {
      result: empty,
      // Recheck durable storage shortly so another server instance's first
      // successful sync becomes visible without this process calling Hirebase.
      expiresAt: now + 5_000,
      stale: false,
      syncMode: "empty",
    };
    return {
      ...empty,
      syncMode: "empty",
      fromCache: true,
      stale: false,
    };
  }

  if (cooldownUntil > now) {
    const saved = restored || emptySavedResult(state);
    hirebaseCache = {
      result: saved,
      expiresAt: Math.max(now + 1_000, cooldownUntil),
      stale: false,
      syncMode: "cooldown",
    };
    return {
      ...saved,
      syncMode: "cooldown",
      fromCache: true,
      stale: false,
    };
  }

  // Configuration errors cannot consume provider allowance, so do not start
  // a cooldown until these checks pass.
  if (process.env.DEMO_MODE === "true") {
    throw new Error("Hirebase is disabled while DEMO_MODE is on");
  }
  if (!process.env.HIREBASE_API_KEY) {
    throw new Error("HIREBASE_API_KEY is not configured");
  }

  const syncStartedAt = Date.now();
  const attemptedState: HirebaseSyncState = {
    version: 1,
    lastAttemptAt: syncStartedAt,
  };
  // Save the attempt before the first provider request. A timeout may have
  // consumed allowance, so restarts and repeated clicks must respect it.
  hirebaseLastAttemptAt = syncStartedAt;
  await persistHirebaseAttemptState(attemptedState);

  try {
    const result = await loadHirebaseJobs();
    if (result.jobs.length === 0 && !snapshot) {
      throw new Error("Hirebase returned no usable Abu Dhabi jobs");
    }

    const mergeResult = mergeJobListings(snapshot?.jobs || [], result.jobs);
    const accumulatedResult = {
      ...result,
      // Re-rank the complete persistent set after upsert. Existing snapshots
      // without firmographics still classify through canonical company names.
      jobs: [...mergeResult.jobs].sort(compareJobsByEmployerPriority),
      fetchedJobsCount: result.jobs.length,
      newJobsCount: mergeResult.newJobsCount,
      syncedAt: syncStartedAt,
      nextSyncAt: syncStartedAt + REFRESH_COOLDOWN_MS,
    };
    if (generation !== hirebaseCacheGeneration) {
      throw new Error("Saved listings were cleared while the refresh was running");
    }

    const snapshotSaved = await saveJobListingSnapshot(
      "hirebase",
      accumulatedResult.jobs,
      {
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
        syncedAt: syncStartedAt,
      }
    );
    if (durableStorageConfigured && !snapshotSaved) {
      throw new Error(
        "Hirebase refresh results could not be saved; the previous listings were kept"
      );
    }

    // Never expose or cache fresh results before the durable snapshot write
    // succeeds. Without Blob, local development keeps the existing in-memory
    // behavior.
    hirebaseCache = {
      result: accumulatedResult,
      expiresAt: Date.now() + CACHE_TTL_MS,
      stale: false,
      syncMode: "saved",
    };
    return {
      ...accumulatedResult,
      syncMode: "live",
      fromCache: false,
      stale: false,
    };
  } catch (error) {
    if (generation === hirebaseCacheGeneration && restored) {
      const staleResult: HirebaseStoredResult = {
        ...restored,
        nextSyncAt: syncStartedAt + REFRESH_COOLDOWN_MS,
      };
      hirebaseCache = {
        result: staleResult,
        expiresAt: Date.now() + STALE_RETRY_TTL_MS,
        stale: true,
        syncMode: "stale",
      };
      return {
        ...staleResult,
        syncMode: "stale",
        fromCache: true,
        stale: true,
      };
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
      syncMode: hirebaseCache.syncMode,
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
