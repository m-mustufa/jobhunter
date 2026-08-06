import "server-only";

import { load } from "cheerio";
import { Job } from "@/lib/types";
import { matchTargetTitle, QUERY_GROUPS } from "@/lib/targetRoles";

const LINKEDIN_SEARCH_URL =
  "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const LINKEDIN_JOB_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";
const SEARCH_PAGE_CONCURRENCY = 2;
const FETCH_TIMEOUT_MS = 4_000;
const MAX_RESULTS = 70;
const MIN_TARGET_RESULTS = 60;
const MAX_FOLLOW_UP_SEARCHES = 8;
const PAST_MONTH_DAYS = 30;
const PAST_MONTH_SECONDS = PAST_MONTH_DAYS * 24 * 60 * 60;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const DESCRIPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_DESCRIPTION_CHARS = 18_000;
// Focused queries give every role family a chance to contribute. A single
// 67-title OR expression heavily favors broad titles and returns duplicates
// on deeper pages.
const LINKEDIN_QUERIES = QUERY_GROUPS.map((query) =>
  query.replace(/\s+Abu Dhabi\s*$/i, "").trim()
);

const LINKEDIN_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
  // LinkedIn's public guest pages return different markup to non-browser
  // clients. This request does not contain cookies, credentials, or a logged-in
  // session; it only asks for the same public HTML a signed-out browser sees.
  "user-agent":
    process.env.LINKEDIN_CRAWLER_USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
};

interface LinkedInCard {
  id: string;
  title: string;
  company: string;
  location: string;
  applyLink: string;
  postedAt: string | null;
  postedIso: string | null;
}

export interface LinkedInJobsResult {
  jobs: Job[];
  attemptedSearches: number;
  successfulSearches: number;
  failedSearches: number;
  descriptionFailures: number;
  fromCache: boolean;
  stale: boolean;
}

interface LinkedInCacheEntry {
  expiresAt: number;
  result: Omit<LinkedInJobsResult, "fromCache" | "stale">;
}

let linkedInCache: LinkedInCacheEntry | null = null;
let linkedInRequest: Promise<Omit<LinkedInJobsResult, "fromCache" | "stale">> | null = null;
const descriptionCache = new Map<string, { description: string; expiresAt: number }>();
const descriptionRequests = new Map<string, Promise<string>>();

function cleanInlineText(value: string): string {
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

export function parseLinkedInSearchHtml(html: string): LinkedInCard[] {
  const $ = load(html);
  const cards: LinkedInCard[] = [];

  $("li").each((_, element) => {
    const card = $(element);
    const urn = card.find("[data-entity-urn^='urn:li:jobPosting:']").attr("data-entity-urn") || "";
    const href = card.find("a.base-card__full-link").attr("href") || "";
    const id = urn.match(/jobPosting:(\d+)/i)?.[1] || href.match(/(?:-|\/)(\d+)(?:[?/#]|$)/)?.[1];
    const title = cleanInlineText(card.find(".base-search-card__title").text());
    const company = cleanInlineText(card.find(".base-search-card__subtitle").text());
    const location = cleanInlineText(card.find(".job-search-card__location").text());

    if (!id || !title || !company || !location) return;
    if (!location.toLowerCase().includes("abu dhabi")) return;
    // LinkedIn search is fuzzy. Keep the same title contract as the normal
    // listing feed instead of allowing unrelated roles into this mode.
    if (!matchTargetTitle(title)) return;

    // New listings use `job-search-card__listdate--new` while older cards use
    // `job-search-card__listdate`. The datetime attribute is the stable part.
    const postedTime = card.find("time[datetime]").first();
    const postedIso = postedTime.attr("datetime") || null;
    const postedLabel = cleanInlineText(postedTime.text()) || postedIso;
    cards.push({
      id,
      title,
      company,
      location,
      applyLink: `https://www.linkedin.com/jobs/view/${id}`,
      postedAt: postedLabel,
      postedIso,
    });
  });

  return cards;
}

export function parseLinkedInDescriptionHtml(html: string): string {
  const $ = load(html);
  const description = $(".description__text .show-more-less-html__markup").first();
  if (!description.length) return "";
  description.find("br").replaceWith("\n");
  description.find("li").each((_, element) => {
    $(element).prepend("\n- ").append("\n");
  });
  description.find("p").append("\n");
  return cleanMultilineText(description.text()).slice(0, MAX_DESCRIPTION_CHARS);
}

async function fetchPublicHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: LINKEDIN_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`LinkedIn responded ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSearchPage(query: string, start: number): Promise<LinkedInCard[]> {
  const url = new URL(LINKEDIN_SEARCH_URL);
  url.searchParams.set("keywords", query);
  url.searchParams.set("location", "Abu Dhabi, United Arab Emirates");
  url.searchParams.set("f_TPR", `r${PAST_MONTH_SECONDS}`);
  url.searchParams.set("start", String(start));
  return parseLinkedInSearchHtml(await fetchPublicHtml(url.toString()));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      try {
        results[index] = { status: "fulfilled", value: await worker(values[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => runWorker())
  );
  return results;
}

function postedTimestamp(card: LinkedInCard): number {
  if (!card.postedIso) return 0;
  const value = Date.parse(card.postedIso);
  return Number.isFinite(value) ? value : 0;
}

function wasPostedWithinPastMonth(card: LinkedInCard, now = Date.now()): boolean {
  if (!card.postedIso) return false;
  const posted = Date.parse(card.postedIso);
  if (!Number.isFinite(posted)) return false;

  // LinkedIn returns date-only values. Compare at UTC calendar-day precision
  // so a listing on the thirtieth day is not incorrectly dropped after midnight.
  const today = new Date(now);
  const cutoff = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - PAST_MONTH_DAYS
  );
  return posted >= cutoff && posted <= now;
}

async function crawlLinkedInJobs(): Promise<Omit<LinkedInJobsResult, "fromCache" | "stale">> {
  const collectedCards = new Map<string, LinkedInCard>();
  const firstPageYields = new Map<string, number>();
  let attemptedSearches = 0;
  let successfulSearches = 0;
  let failedSearches = 0;
  let firstFailure: unknown;

  async function runSearchTasks(
    tasks: Array<{ query: string; start: number }>,
    trackYield = false
  ) {
    const pageResults = await mapWithConcurrency(
      tasks,
      SEARCH_PAGE_CONCURRENCY,
      (task) => fetchSearchPage(task.query, task.start)
    );
    attemptedSearches += pageResults.length;
    for (let index = 0; index < pageResults.length; index += 1) {
      const result = pageResults[index];
      const task = tasks[index];
      if (result.status === "fulfilled") {
        successfulSearches += 1;
        // Keep the upstream filter defensive: if LinkedIn returns a stale or
        // undated fuzzy result, it must not enter the past-month listing.
        const validCards = result.value.filter((card) => wasPostedWithinPastMonth(card));
        if (trackYield) firstPageYields.set(task.query, validCards.length);
        for (const card of validCards) collectedCards.set(card.id, card);
      } else {
        failedSearches += 1;
        firstFailure ??= result.reason;
      }
    }
  }

  // Search each role family once instead of deep-paging one huge OR query.
  // This produces broader functional coverage and much less ranking skew.
  await runSearchTasks(
    LINKEDIN_QUERIES.map((query) => ({ query, start: 0 })),
    true
  );

  // Most runs reach 60-70 unique jobs from the first page of each group. If
  // they do not, request a second page only from the strongest groups, with a
  // strict eight-request cap so the route remains safely below 60 seconds.
  if (collectedCards.size < MIN_TARGET_RESULTS) {
    const followUpTasks = [...firstPageYields.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FOLLOW_UP_SEARCHES)
      .map(([query]) => ({ query, start: 10 }));

    for (let index = 0; index < followUpTasks.length; index += SEARCH_PAGE_CONCURRENCY) {
      await runSearchTasks(followUpTasks.slice(index, index + SEARCH_PAGE_CONCURRENCY));
      if (collectedCards.size >= MAX_RESULTS) break;
    }
  }

  if (successfulSearches === 0) {
    throw new Error(
      firstFailure instanceof Error ? firstFailure.message : "LinkedIn could not be reached"
    );
  }

  const cards = [...collectedCards.values()]
    .sort((a, b) => postedTimestamp(b) - postedTimestamp(a))
    .slice(0, MAX_RESULTS);

  // Search cards are enough to render the listing. Fetching every detail page
  // in a burst triggers LinkedIn's public-endpoint rate limit, so the full
  // description is intentionally loaded only for the job the user chooses
  // to tailor (see fetchLinkedInJobDescription below).
  const jobs = cards.map((card): Job => {
    return {
      id: `linkedin-${card.id}`,
      title: card.title,
      company: card.company,
      location: card.location,
      salary: null,
      description: `LinkedIn listing for ${card.title} at ${card.company} in ${card.location}. The full description will be loaded before tailoring.`,
      applyLink: card.applyLink,
      source: "LinkedIn",
      postedAt: card.postedAt,
    };
  });

  return {
    jobs,
    attemptedSearches,
    successfulSearches,
    failedSearches,
    descriptionFailures: 0,
  };
}

export async function fetchLinkedInJobDescription(jobId: string): Promise<string> {
  if (!/^\d{6,}$/.test(jobId)) throw new Error("Invalid LinkedIn job ID");

  const cached = descriptionCache.get(jobId);
  if (cached && cached.expiresAt > Date.now()) return cached.description;

  const existing = descriptionRequests.get(jobId);
  if (existing) return existing;

  const request = (async () => {
    const html = await fetchPublicHtml(`${LINKEDIN_JOB_URL}/${jobId}`);
    const description = parseLinkedInDescriptionHtml(html);
    if (!description) throw new Error("LinkedIn did not return a job description");
    descriptionCache.set(jobId, {
      description,
      expiresAt: Date.now() + DESCRIPTION_CACHE_TTL_MS,
    });
    return description;
  })();
  descriptionRequests.set(jobId, request);

  try {
    return await request;
  } finally {
    if (descriptionRequests.get(jobId) === request) descriptionRequests.delete(jobId);
  }
}

export async function fetchLinkedInJobs(forceRefresh = false): Promise<LinkedInJobsResult> {
  if (!forceRefresh && linkedInCache && linkedInCache.expiresAt > Date.now()) {
    return { ...linkedInCache.result, fromCache: true, stale: false };
  }

  // Coalesce concurrent toggle/refresh requests so one server process never
  // crawls the same combined public search twice at the same time.
  const request = linkedInRequest || crawlLinkedInJobs();
  linkedInRequest = request;
  try {
    const result = await request;
    if (result.jobs.length > 0) {
      linkedInCache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return { ...result, fromCache: false, stale: false };
  } catch (error) {
    // An expired cache is still better than replacing a LinkedIn-only view
    // with mixed sources during a temporary block or network drop.
    if (linkedInCache) {
      return { ...linkedInCache.result, fromCache: true, stale: true };
    }
    throw error;
  } finally {
    if (linkedInRequest === request) linkedInRequest = null;
  }
}
