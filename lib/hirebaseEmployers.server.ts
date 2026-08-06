import "server-only";

import { get, put } from "@vercel/blob";
import { EMPLOYER_DIRECTORY, linkedInSearchUrl } from "@/lib/employerDirectory";
import { EmployerProfile, EmployersResponse } from "@/lib/employers";

const HIREBASE_COMPANY_SEARCH_URL =
  "https://api.hirebase.org/v2/hirebase/companies/search";
const EMPLOYER_SNAPSHOT_PATH = "jobhunter/employers/hirebase.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const STALE_RETRY_TTL_MS = 5 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_EMPLOYERS = 100;
const EMPLOYER_QUERY_VERSION = 2;

interface HirebaseCompany {
  company_name?: unknown;
  company_slug?: unknown;
  description_summary?: unknown;
  linkedin_link?: unknown;
  company_link?: unknown;
  job_board?: unknown;
  company_logo?: unknown;
  industries?: unknown;
  subindustries?: unknown;
  size_range?: {
    min?: unknown;
    max?: unknown;
  } | null;
}

interface HirebaseCompanyResponse {
  companies?: unknown;
  total_count?: unknown;
}

interface EmployerSnapshot {
  version: typeof EMPLOYER_QUERY_VERSION;
  savedAt: number;
  employers: EmployerProfile[];
}

let memoryCache: EmployerSnapshot | null = null;
let employerRequest: Promise<EmployersResponse> | null = null;
let failedResponseCache: { expiresAt: number; response: EmployersResponse } | null = null;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))].slice(0, 12);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeUrl(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function employerId(name: string, slug = ""): string {
  return (slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `employer-${name.length}`;
}

function toEmployer(raw: HirebaseCompany): EmployerProfile | null {
  const name = cleanText(raw.company_name);
  if (!name) return null;
  const slug = cleanText(raw.company_slug);
  return {
    id: employerId(name, slug),
    name,
    description:
      cleanText(raw.description_summary) ||
      `${name} is currently represented in the Hirebase company directory.`,
    logoUrl: safeUrl(raw.company_logo),
    linkedinUrl: safeUrl(raw.linkedin_link),
    websiteUrl: safeUrl(raw.company_link),
    jobsSearchUrl: linkedInSearchUrl(name),
    jobBoard: cleanText(raw.job_board) || null,
    industries: cleanStringList(raw.industries),
    subindustries: cleanStringList(raw.subindustries),
    sizeMin: positiveInteger(raw.size_range?.min),
    sizeMax: positiveInteger(raw.size_range?.max),
    source: "hirebase",
  };
}

function referenceEmployers(): EmployerProfile[] {
  return EMPLOYER_DIRECTORY.flatMap((group) =>
    group.employers.map((employer) => ({
      id: employerId(employer.name),
      name: employer.name,
      description: employer.blurb,
      logoUrl: null,
      linkedinUrl: null,
      websiteUrl: null,
      jobsSearchUrl: linkedInSearchUrl(employer.name),
      jobBoard: null,
      industries: [group.category],
      subindustries: [],
      sizeMin: null,
      sizeMax: null,
      source: "reference" as const,
    }))
  );
}

function isEmployer(value: unknown): value is EmployerProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const employer = value as Partial<EmployerProfile>;
  return Boolean(
    typeof employer.id === "string" &&
      employer.id &&
      typeof employer.name === "string" &&
      employer.name &&
      typeof employer.description === "string" &&
      (employer.logoUrl === null || typeof employer.logoUrl === "string") &&
      (employer.linkedinUrl === null || typeof employer.linkedinUrl === "string") &&
      (employer.websiteUrl === null || typeof employer.websiteUrl === "string") &&
      typeof employer.jobsSearchUrl === "string" &&
      (employer.jobBoard === null || typeof employer.jobBoard === "string") &&
      Array.isArray(employer.industries) &&
      employer.industries.every((item) => typeof item === "string") &&
      Array.isArray(employer.subindustries) &&
      employer.subindustries.every((item) => typeof item === "string") &&
      (employer.sizeMin === null || typeof employer.sizeMin === "number") &&
      (employer.sizeMax === null || typeof employer.sizeMax === "number") &&
      employer.source === "hirebase"
  );
}

function isEmployerSnapshot(value: unknown): value is EmployerSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<EmployerSnapshot>;
  return Boolean(
    snapshot.version === EMPLOYER_QUERY_VERSION &&
      typeof snapshot.savedAt === "number" &&
      Number.isFinite(snapshot.savedAt) &&
      snapshot.savedAt > 0 &&
      Array.isArray(snapshot.employers) &&
      snapshot.employers.length > 0 &&
      snapshot.employers.every(isEmployer)
  );
}

async function loadSnapshot(): Promise<EmployerSnapshot | null> {
  if (memoryCache) return memoryCache;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const result = await get(EMPLOYER_SNAPSHOT_PATH, {
      access: "private",
      token,
      useCache: false,
    });
    if (!result?.stream) return null;
    const parsed = JSON.parse(await new Response(result.stream as any).text()) as unknown;
    if (!isEmployerSnapshot(parsed)) return null;
    memoryCache = parsed;
    return parsed;
  } catch (error) {
    console.error("Could not load the saved Hirebase employer directory", error);
    return null;
  }
}

async function saveSnapshot(snapshot: EmployerSnapshot): Promise<void> {
  memoryCache = snapshot;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    await put(EMPLOYER_SNAPSHOT_PATH, JSON.stringify(snapshot), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token,
    });
  } catch (error) {
    console.error("Could not save the Hirebase employer directory", error);
  }
}

async function fetchLiveEmployers(): Promise<EmployerProfile[]> {
  if (process.env.DEMO_MODE === "true") {
    throw new Error("Hirebase is disabled while DEMO_MODE is on");
  }
  const key = process.env.HIREBASE_API_KEY;
  if (!key) throw new Error("HIREBASE_API_KEY is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(HIREBASE_COMPANY_SEARCH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({
        hq_geolocations: [
          {
            city: "Abu Dhabi",
            region: "Abu Dhabi",
            country: "United Arab Emirates",
          },
        ],
        hide_recruiter_agencies: true,
        page: 1,
        limit: MAX_EMPLOYERS,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Hirebase rejected the API key");
      }
      if (response.status === 429) throw new Error("Hirebase rate limit was reached");
      throw new Error(`Hirebase company search responded ${response.status}`);
    }

    const payload = (await response.json()) as HirebaseCompanyResponse;
    if (!Array.isArray(payload.companies)) {
      throw new Error("Hirebase returned an invalid company response");
    }

    const employers = new Map<string, EmployerProfile>();
    for (const raw of payload.companies) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const employer = toEmployer(raw as HirebaseCompany);
      if (!employer) continue;
      const key = employer.name.toLowerCase();
      if (!employers.has(key)) employers.set(key, employer);
    }
    if (employers.size === 0) throw new Error("Hirebase returned no usable Abu Dhabi employers");
    return [...employers.values()].sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    clearTimeout(timeout);
  }
}

async function loadEmployers(): Promise<EmployersResponse> {
  const snapshot = await loadSnapshot();
  const now = Date.now();
  if (snapshot && now - snapshot.savedAt < CACHE_TTL_MS) {
    return {
      employers: snapshot.employers,
      fetchedAt: snapshot.savedAt,
      source: "saved",
      fromCache: true,
      stale: false,
      note: `Showing ${snapshot.employers.length} saved Hirebase employers.`,
    };
  }

  try {
    const employers = await fetchLiveEmployers();
    const nextSnapshot: EmployerSnapshot = {
      version: EMPLOYER_QUERY_VERSION,
      savedAt: now,
      employers,
    };
    await saveSnapshot(nextSnapshot);
    failedResponseCache = null;
    return {
      employers,
      fetchedAt: now,
      source: "hirebase",
      fromCache: false,
      stale: false,
      note: `Loaded ${employers.length} employers from Hirebase Company Search.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hirebase could not be reached";
    if (snapshot) {
      const response: EmployersResponse = {
        employers: snapshot.employers,
        fetchedAt: snapshot.savedAt,
        source: "saved",
        fromCache: true,
        stale: true,
        note: `Hirebase is unavailable (${message}); showing ${snapshot.employers.length} saved employers.`,
      };
      failedResponseCache = { expiresAt: now + STALE_RETRY_TTL_MS, response };
      return response;
    }
    const employers = referenceEmployers();
    const response: EmployersResponse = {
      employers,
      fetchedAt: now,
      source: "reference",
      fromCache: true,
      stale: true,
      note: `Hirebase is unavailable (${message}); showing the curated Abu Dhabi reference directory.`,
      error: message,
    };
    failedResponseCache = { expiresAt: now + STALE_RETRY_TTL_MS, response };
    return response;
  }
}

export async function fetchHirebaseEmployers(): Promise<EmployersResponse> {
  const now = Date.now();
  if (failedResponseCache && failedResponseCache.expiresAt > now) {
    return failedResponseCache.response;
  }
  if (memoryCache && now - memoryCache.savedAt < CACHE_TTL_MS) {
    return {
      employers: memoryCache.employers,
      fetchedAt: memoryCache.savedAt,
      source: "saved",
      fromCache: true,
      stale: false,
      note: `Showing ${memoryCache.employers.length} saved Hirebase employers.`,
    };
  }

  const request = employerRequest || loadEmployers();
  employerRequest = request;
  try {
    return await request;
  } finally {
    if (employerRequest === request) employerRequest = null;
  }
}
