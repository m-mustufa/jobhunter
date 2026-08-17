import "server-only";

import { createHash } from "crypto";
import { get, put } from "@vercel/blob";
import { Job } from "./types";

const CACHE_VERSION = 1;
const DEFAULT_CACHE_DAYS = 45;
const MIN_CACHE_DAYS = 30;
const MAX_CACHE_DAYS = 60;
const MAX_MEMORY_ENTRIES = 100;

export interface RoleResearchSource {
  title: string;
  url: string;
}

export interface RoleResearchBrief {
  version: 1;
  cacheKey: string;
  normalizedRole: string;
  domain: string;
  marketContext: string;
  expectations: string[];
  sources: RoleResearchSource[];
  researchedAt: number;
  expiresAt: number;
}

const memoryCache = new Map<string, RoleResearchBrief>();

function boundedCacheDays(): number {
  const configured = Number.parseInt(
    process.env.ROLE_RESEARCH_CACHE_DAYS || "",
    10
  );
  if (!Number.isFinite(configured)) return DEFAULT_CACHE_DAYS;
  return Math.min(MAX_CACHE_DAYS, Math.max(MIN_CACHE_DAYS, configured));
}

function normalizeWhitespace(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedRoleTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\bsvp\b/g, "senior vice president")
    .replace(/\bavp\b/g, "assistant vice president")
    .replace(/\bvp\b/g, "vice president")
    .replace(/\bceo\b/g, "chief executive officer")
    .replace(/\bcoo\b/g, "chief operating officer")
    .replace(/\bcfo\b/g, "chief financial officer")
    .replace(/\bcto\b/g, "chief technology officer")
    .replace(/\bcio\b/g, "chief information officer")
    .replace(/\bhr\b/g, "human resources")
    .replace(/\bqa[\s/-]*qc\b/g, "quality assurance quality control")
    .replace(/\bhse\b/g, "health safety environment")
    .replace(/\babu dhabi\b|\buae\b|\bunited arab emirates\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function inferDomain(description: string): string {
  const text = description.toLowerCase();
  const domains: Array<[string, RegExp]> = [
    ["energy", /\b(oil|gas|petroleum|reservoir|subsurface|drilling|energy|adnoc)\b/],
    ["financial-services", /\b(bank|banking|finance|financial|investment|treasury|insurance|fintech)\b/],
    ["government-regulatory", /\b(government|public sector|authority|regulatory|policy|compliance|governance)\b/],
    ["technology-data", /\b(software|technology|digital|data|cyber|cloud|artificial intelligence|\bai\b|\bit\b)\b/],
    ["construction-engineering", /\b(construction|engineering|project controls|epc|infrastructure|qa[\s/-]*qc)\b/],
    ["healthcare", /\b(healthcare|hospital|clinical|patient|medical|pharma)\b/],
    ["logistics-ports", /\b(logistics|port|ports|shipping|maritime|freight|supply chain)\b/],
    ["real-estate", /\b(real estate|property|development|facilities)\b/],
    ["hospitality-retail", /\b(hospitality|hotel|restaurant|retail|f&b|food and beverage)\b/],
    ["legal", /\b(legal|counsel|lawyer|law firm|litigation|contract law)\b/],
  ];
  return domains.find(([, pattern]) => pattern.test(text))?.[0] || "general";
}

export function getRoleResearchIdentity(
  job: Pick<Job, "title" | "description">
): { cacheKey: string; normalizedRole: string; domain: string } {
  const normalizedRole = normalizedRoleTitle(job.title) || "managerial role";
  const domain = inferDomain(job.description);
  return {
    cacheKey: `${normalizedRole}|${domain}`,
    normalizedRole,
    domain,
  };
}

function cachePath(cacheKey: string): string {
  const digest = createHash("sha256").update(cacheKey).digest("hex").slice(0, 32);
  return `jobhunter/role-research/${digest}.json`;
}

function validSource(value: unknown): value is RoleResearchSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Partial<RoleResearchSource>;
  if (typeof source.title !== "string" || typeof source.url !== "string") return false;
  try {
    const url = new URL(source.url);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validBrief(value: unknown, expectedKey: string): value is RoleResearchBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const brief = value as Partial<RoleResearchBrief>;
  return Boolean(
    brief.version === CACHE_VERSION &&
      brief.cacheKey === expectedKey &&
      typeof brief.normalizedRole === "string" &&
      brief.normalizedRole &&
      typeof brief.domain === "string" &&
      brief.domain &&
      typeof brief.marketContext === "string" &&
      Array.isArray(brief.expectations) &&
      brief.expectations.length >= 3 &&
      brief.expectations.every((entry) => typeof entry === "string" && entry.length >= 10) &&
      Array.isArray(brief.sources) &&
      brief.sources.every(validSource) &&
      typeof brief.researchedAt === "number" &&
      Number.isFinite(brief.researchedAt) &&
      typeof brief.expiresAt === "number" &&
      Number.isFinite(brief.expiresAt) &&
      brief.expiresAt > Date.now()
  );
}

function remember(brief: RoleResearchBrief): void {
  memoryCache.delete(brief.cacheKey);
  memoryCache.set(brief.cacheKey, brief);
  while (memoryCache.size > MAX_MEMORY_ENTRIES) {
    const oldest = memoryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

export async function loadRoleResearchBrief(
  job: Pick<Job, "title" | "description">
): Promise<RoleResearchBrief | null> {
  const { cacheKey } = getRoleResearchIdentity(job);
  const inMemory = memoryCache.get(cacheKey);
  if (inMemory && validBrief(inMemory, cacheKey)) return inMemory;
  if (inMemory) memoryCache.delete(cacheKey);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const result = await get(cachePath(cacheKey), {
      access: "private",
      token,
      useCache: false,
    });
    if (!result?.stream) return null;
    const parsed = JSON.parse(
      await new Response(result.stream as any).text()
    ) as unknown;
    if (!validBrief(parsed, cacheKey)) return null;
    remember(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function sanitizeExpectations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const expectations: string[] = [];
  for (const entry of value) {
    const text = normalizeWhitespace(entry).slice(0, 280);
    const key = text.toLowerCase();
    if (text.length < 20 || seen.has(key)) continue;
    seen.add(key);
    expectations.push(text);
    if (expectations.length >= 8) break;
  }
  return expectations;
}

function sanitizeSources(value: unknown): RoleResearchSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: RoleResearchSource[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    const title = normalizeWhitespace(raw.title).slice(0, 180) || "Role research source";
    const urlText = normalizeWhitespace(raw.url);
    try {
      const url = new URL(urlText);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || seen.has(url.href)) {
        continue;
      }
      seen.add(url.href);
      sources.push({ title, url: url.href });
      if (sources.length >= 6) break;
    } catch {
      // Ignore malformed URLs returned by the model/tool.
    }
  }
  return sources;
}

export async function saveRoleResearchBrief(
  job: Pick<Job, "title" | "description">,
  rawResearch: unknown,
  toolSources: RoleResearchSource[] = []
): Promise<RoleResearchBrief | null> {
  if (!rawResearch || typeof rawResearch !== "object" || Array.isArray(rawResearch)) {
    return null;
  }
  const raw = rawResearch as Record<string, unknown>;
  const expectations = sanitizeExpectations(raw.expectations);
  if (expectations.length < 3) return null;

  const identity = getRoleResearchIdentity(job);
  const researchedAt = Date.now();
  const sources = sanitizeSources([
    ...toolSources,
    ...(Array.isArray(raw.sources) ? raw.sources : []),
  ]);
  const brief: RoleResearchBrief = {
    version: CACHE_VERSION,
    ...identity,
    marketContext: normalizeWhitespace(raw.marketContext).slice(0, 600),
    expectations,
    sources,
    researchedAt,
    expiresAt: researchedAt + boundedCacheDays() * 24 * 60 * 60 * 1_000,
  };
  remember(brief);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      await put(cachePath(identity.cacheKey), JSON.stringify(brief), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        token,
      });
    } catch (error) {
      console.error("saveRoleResearchBrief: durable cache write failed", error);
    }
  }
  return brief;
}

export function formatRoleResearchBrief(brief: RoleResearchBrief): string {
  const lines = [
    `Normalized role: ${brief.normalizedRole}`,
    `Functional domain: ${brief.domain}`,
    brief.marketContext ? `Abu Dhabi/UAE market context: ${brief.marketContext}` : "",
    "Common role expectations:",
    ...brief.expectations.map((expectation, index) => `${index + 1}. ${expectation}`),
  ];
  return lines.filter(Boolean).join("\n");
}
