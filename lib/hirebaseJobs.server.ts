import "server-only";

import { load } from "cheerio";
import {
  JobListingSnapshot,
  loadJobListingSnapshot,
  mergeJobListings,
  saveJobListingSnapshot,
} from "@/lib/jobListingStore.server";
import { QUERY_GROUPS, TARGET_ROLE_TITLES } from "@/lib/targetRoles";
import { Job } from "@/lib/types";

const HIREBASE_SEARCH_URL = "https://api.hirebase.org/v2/jobs/search";
const PAST_MONTH_DAYS = 30;
const MAX_RESULTS = 70;
const RESULTS_PER_GROUP = 10;
// Keep one request slot free for the lazy Company Search page. Hirebase caps
// search endpoints at four requests per second, and a user can open Employers
// while a job refresh is still winding down on the server.
const REQUESTS_PER_BATCH = 3;
const BATCH_INTERVAL_MS = 1_050;
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const STALE_RETRY_TTL_MS = 5 * 60 * 1_000;
const MAX_DESCRIPTION_CHARS = 18_000;
const HIREBASE_ROLE_TITLES = TARGET_ROLE_TITLES.map((title) =>
  title === "Governance, Risk and Compliance Manager"
    ? "Governance Risk and Compliance Manager"
    : title
);
const HIREBASE_TITLE_GROUPS = QUERY_GROUPS.map((query) =>
  query
    .replace(/\s+Abu Dhabi\s*$/i, "")
    .split(/\s+OR\s+/i)
    .map((title) =>
      title === "Governance Risk and Compliance Manager"
        ? "Governance Risk and Compliance Manager"
        : title.trim()
    )
    .filter(Boolean)
);

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
}

export interface HirebaseJobsResult {
  jobs: Job[];
  upstreamTotal: number | null;
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  fetchedJobsCount?: number;
  newJobsCount?: number;
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

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isTargetTitle(value: string): boolean {
  const postingTitle = normalizeTitle(value);
  return HIREBASE_ROLE_TITLES.some((title) =>
    postingTitle.includes(normalizeTitle(title))
  );
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

function toJob(raw: HirebaseJob): Job | null {
  const id = cleanInlineText(raw._id);
  const title = cleanInlineText(raw.job_title_raw) || cleanInlineText(raw.job_title);
  const company = cleanInlineText(raw.company_name);
  const description =
    cleanDescription(raw.description_raw) ||
    cleanDescription(raw.description) ||
    cleanDescription(raw.requirements_summary);
  const applyLink = normalizeUrl(raw.application_link) || normalizeUrl(raw.job_board_link);

  if (
    !id ||
    !title ||
    !company ||
    !description ||
    !applyLink ||
    isExpired(raw.expired) ||
    !isAbuDhabi(raw) ||
    !isTargetTitle(title)
  ) {
    return null;
  }

  return {
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

async function fetchHirebaseGroup(key: string, jobTitles: string[]): Promise<HirebaseResponse> {
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
        geofilter_params: { mode: "strict", radius: 50, unit: "km" },
        days_ago: PAST_MONTH_DAYS,
        include_expired: "false",
        return_raw_description: "true",
        sort_by: "date_posted",
        sort_order: "desc",
        page: 1,
        limit: RESULTS_PER_GROUP,
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

  const rawJobs: HirebaseJob[] = [];
  let upstreamTotal = 0;
  let hasUpstreamTotal = false;
  let successfulSearches = 0;
  let failedSearches = 0;
  let firstFailure: unknown;
  let previousBatchStartedAt = 0;

  for (let index = 0; index < HIREBASE_TITLE_GROUPS.length; index += REQUESTS_PER_BATCH) {
    const elapsed = Date.now() - previousBatchStartedAt;
    if (previousBatchStartedAt && elapsed < BATCH_INTERVAL_MS) {
      await wait(BATCH_INTERVAL_MS - elapsed);
    }
    previousBatchStartedAt = Date.now();
    const groupBatch = HIREBASE_TITLE_GROUPS.slice(index, index + REQUESTS_PER_BATCH);
    const responses = await Promise.allSettled(
      groupBatch.map((jobTitles) => fetchHirebaseGroup(key, jobTitles))
    );
    for (const response of responses) {
      if (response.status === "fulfilled") {
        successfulSearches += 1;
        rawJobs.push(...(response.value.jobs || []));
        if (typeof response.value.total_count === "number") {
          upstreamTotal += response.value.total_count;
          hasUpstreamTotal = true;
        }
      } else {
        failedSearches += 1;
        firstFailure ??= response.reason;
      }
    }
  }

  if (successfulSearches === 0) {
    throw firstFailure instanceof Error ? firstFailure : new Error("Hirebase could not be reached");
  }

  const unique = new Map<string, Job>();
  for (const raw of rawJobs) {
    const job = toJob(raw);
    if (job && !unique.has(job.id)) unique.set(job.id, job);
  }
  const jobs = [...unique.values()]
    .sort((a, b) => postedTimestamp(b) - postedTimestamp(a))
    .slice(0, MAX_RESULTS);

  return {
    jobs,
    upstreamTotal: hasUpstreamTotal ? upstreamTotal : null,
    attemptedSearches: HIREBASE_TITLE_GROUPS.length,
    successfulSearches,
    failedSearches,
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
