import "server-only";

import { load } from "cheerio";
import { matchTargetTitle } from "@/lib/targetRoles";

// LinkedIn's public (signed-out) job search, the same pages a visitor sees. No
// cookies or account are used. LinkedIn rate-limits this quickly, so the crawl
// is deliberately small and polite, and it stops at the first sign of a block.
const LINKEDIN_SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const LINKEDIN_JOB_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";
// LinkedIn's id for "Abu Dhabi, Abu Dhabi Emirate, United Arab Emirates". The
// text form of `location` is ignored by some LinkedIn pages; the id is not.
export const ABU_DHABI_GEO_ID = "104524176";
const PAST_MONTH_SECONDS = 30 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_DESCRIPTION_CHARS = 18_000;
const DESCRIPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const REQUEST_GAP_MS = 700;
// LinkedIn refused the 5th request in a row from Vercel, so a sync reads only a
// few searches and the next sync carries on where this one stopped.
const MAX_REQUESTS_PER_SYNC = 4;
const PAGE_SIZE = 10;

// Role families searched, one request each. A single huge OR query favours broad
// titles, so the families stay separate. Same coverage as lib/targetRoles.
export const LINKEDIN_QUERIES = [
  '("Vice President" OR VP OR AVP OR "General Manager" OR "Managing Director" OR "Chief Operating Officer" OR "Chief Executive Officer")',
  '(Director OR "Head of" OR "Department Head" OR "Division Head" OR "Country Manager")',
  '("IT Manager" OR "Technology Manager" OR "Engineering Manager" OR "Head of Technology" OR "Digital Transformation" OR "Data Manager")',
  '("Project Director" OR "Senior Project Manager" OR "Program Manager" OR "Construction Manager" OR "Operations Manager")',
  '("Finance Manager" OR "Commercial Manager" OR "Treasury Manager" OR "Investment Manager" OR "Business Development Manager")',
  '("HR Manager" OR "Strategy Manager" OR "Transformation Manager" OR Governance OR "Risk Manager" OR "Compliance Manager")',
  '("Supply Chain Manager" OR "Procurement Manager" OR "Contracts Manager" OR "Quality Manager" OR "HSE Manager")',
  '("Senior Manager" OR "Team Leader" OR "Section Head" OR Lead)',
  '("Marketing Manager" OR "Communications Manager" OR "Legal Counsel" OR "Sustainability Manager" OR "Facilities Manager" OR "Category Manager")',
];

// One slot is one request: a role family and a results page. Every family's first
// page comes before any second page, so a partial cycle covers the newest jobs first.
export const LINKEDIN_SLOTS: { query: string; start: number }[] = [0, PAGE_SIZE].flatMap((start) =>
  LINKEDIN_QUERIES.map((query) => ({ query, start }))
);

const LINKEDIN_HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    process.env.LINKEDIN_CRAWLER_USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
};

export interface LinkedInCard {
  id: string;
  title: string;
  company: string;
  location: string;
  applyLink: string;
  /** ISO date (day precision) as LinkedIn gives it, or null. */
  postedIso: string | null;
}

export interface LinkedInCrawl {
  cards: LinkedInCard[];
  attemptedRequests: number;
  failedRequests: number;
  /** LinkedIn answered 429/403/999: the crawl stopped and the list is partial. */
  blocked: boolean;
  /** Where the next sync should start (an index into LINKEDIN_SLOTS). */
  nextCursor: number;
  /** Searches read successfully in this sync, out of LINKEDIN_SLOTS.length in a full cycle. */
  slotsRead: number;
  totalSlots: number;
}

/** LinkedIn refused to serve us (rate limit or block). */
export class LinkedInBlockedError extends Error {
  constructor(readonly status: number) {
    super(`LinkedIn blocked the request (HTTP ${status})`);
  }
}

function cleanInlineText(value: string): string {
  return value.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value: string): string {
  return value
    .replace(/[​-‍﻿]/g, "")
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
    // LinkedIn search is fuzzy; keep the same title contract as the career-site feed.
    if (!matchTargetTitle(title)) return;

    cards.push({
      id,
      title,
      company,
      location,
      applyLink: `https://www.linkedin.com/jobs/view/${id}`,
      // The datetime attribute is the stable part; the visible text is "2 days ago".
      postedIso: card.find("time[datetime]").first().attr("datetime") || null,
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

async function fetchPublicHtml(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetch(url, {
    cache: "no-store",
    headers: LINKEDIN_HEADERS,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  // 429 is the rate limit; 999 is LinkedIn's own "request denied" code.
  if (response.status === 429 || response.status === 403 || response.status === 999) {
    throw new LinkedInBlockedError(response.status);
  }
  if (!response.ok) throw new Error(`LinkedIn responded ${response.status}`);
  return response.text();
}

export function searchUrl(keywords: string, start: number): string {
  const url = new URL(LINKEDIN_SEARCH_URL);
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("geoId", ABU_DHABI_GEO_ID);
  url.searchParams.set("f_TPR", `r${PAST_MONTH_SECONDS}`);
  url.searchParams.set("sortBy", "DD");
  url.searchParams.set("start", String(start));
  return url.toString();
}

function wasPostedWithinPastMonth(card: LinkedInCard, now = Date.now()): boolean {
  if (!card.postedIso) return false;
  const posted = Date.parse(card.postedIso);
  if (!Number.isFinite(posted)) return false;
  // Date-only values: compare by calendar day so day 30 is not dropped after midnight.
  const today = new Date(now);
  const cutoff = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 30);
  return posted >= cutoff && posted <= now;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the next few searches, starting at `cursor`, one at a time with a short
 * gap. The first block (429/403/999) stops the crawl, and the next sync retries
 * the search that was refused. Throws only when not a single search could be read.
 */
export async function crawlLinkedInCards(signal?: AbortSignal, cursor = 0): Promise<LinkedInCrawl> {
  const total = LINKEDIN_SLOTS.length;
  let index = ((Math.trunc(cursor) % total) + total) % total;
  const collected = new Map<string, LinkedInCard>();
  let attempted = 0;
  let failed = 0;
  let read = 0;
  let blocked = false;
  let firstFailure: unknown;

  while (read + failed < MAX_REQUESTS_PER_SYNC && !blocked && !signal?.aborted) {
    if (attempted > 0) await pause(REQUEST_GAP_MS);
    const slot = LINKEDIN_SLOTS[index];
    attempted += 1;
    try {
      const cards = (await fetchPublicHtmlCards(slot.query, slot.start, signal)).filter((card) =>
        wasPostedWithinPastMonth(card)
      );
      for (const card of cards) collected.set(card.id, card);
      read += 1;
      index = (index + 1) % total;
    } catch (error) {
      failed += 1;
      firstFailure ??= error;
      if (error instanceof LinkedInBlockedError) blocked = true;
      // A block is retried next time; any other failure is skipped so one bad
      // search cannot hold the cursor in place forever.
      else index = (index + 1) % total;
    }
  }

  if (read === 0 && failed > 0) {
    throw firstFailure instanceof Error ? firstFailure : new Error("LinkedIn could not be reached");
  }
  return {
    cards: [...collected.values()],
    attemptedRequests: attempted,
    failedRequests: failed,
    blocked,
    nextCursor: index,
    slotsRead: read,
    totalSlots: total,
  };
}

async function fetchPublicHtmlCards(query: string, start: number, signal?: AbortSignal) {
  return parseLinkedInSearchHtml(await fetchPublicHtml(searchUrl(query, start), signal));
}

const descriptionCache = new Map<string, { description: string; expiresAt: number }>();
const descriptionRequests = new Map<string, Promise<string>>();

/** The full text of one LinkedIn posting, fetched when the job is opened or tailored. */
export async function fetchLinkedInJobDescription(jobId: string): Promise<string> {
  if (!/^\d{6,}$/.test(jobId)) throw new Error("Invalid LinkedIn job ID");

  const cached = descriptionCache.get(jobId);
  if (cached && cached.expiresAt > Date.now()) return cached.description;

  const existing = descriptionRequests.get(jobId);
  if (existing) return existing;

  const request = (async () => {
    const description = parseLinkedInDescriptionHtml(await fetchPublicHtml(`${LINKEDIN_JOB_URL}/${jobId}`));
    if (!description) throw new Error("LinkedIn did not return a job description");
    descriptionCache.set(jobId, { description, expiresAt: Date.now() + DESCRIPTION_CACHE_TTL_MS });
    return description;
  })();
  descriptionRequests.set(jobId, request);
  try {
    return await request;
  } finally {
    if (descriptionRequests.get(jobId) === request) descriptionRequests.delete(jobId);
  }
}
