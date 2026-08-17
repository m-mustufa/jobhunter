import { EMPLOYER_DIRECTORY } from "@/lib/employerDirectory";
import type { EmployerPriorityTier, Job } from "@/lib/types";

export interface EmployerProviderFilters {
  exactNames: readonly string[];
  partialNames: readonly string[];
}

export interface EmployerPriority {
  tier: EmployerPriorityTier;
  score: number;
  matchedName: string | null;
}

type EmployerPriorityInput = Pick<Job, "company"> &
  Partial<
    Pick<
      Job,
      | "companySizeMin"
      | "companySizeMax"
      | "companyRevenueUsd"
      | "companyType"
      | "companyPubliclyTraded"
      | "directEmployer"
    >
  >;

interface EmployerSeed {
  canonical: string;
  aliases?: readonly string[];
}

const GOVERNMENT_GRE_SEEDS: readonly EmployerSeed[] = [
  { canonical: "ADNOC", aliases: ["Abu Dhabi National Oil Company", "ADNOC Group"] },
  { canonical: "ADQ", aliases: ["Abu Dhabi Developmental Holding Company"] },
  { canonical: "Mubadala Investment Company", aliases: ["Mubadala"] },
  { canonical: "Abu Dhabi Investment Authority", aliases: ["ADIA"] },
  { canonical: "Abu Dhabi Investment Council", aliases: ["ADIC"] },
  { canonical: "Emirates Investment Authority", aliases: ["EIA"] },
  { canonical: "International Holding Company", aliases: ["IHC"] },
  { canonical: "Alpha Dhabi Holding", aliases: ["Alpha Dhabi"] },
  { canonical: "Abu Dhabi Fund for Development", aliases: ["ADFD"] },
  { canonical: "TAQA", aliases: ["Abu Dhabi National Energy Company"] },
  { canonical: "Masdar", aliases: ["Abu Dhabi Future Energy Company"] },
  { canonical: "Emirates Nuclear Energy Corporation", aliases: ["ENEC", "Emirates Nuclear Energy Company"] },
  { canonical: "Nawah Energy Company", aliases: ["Nawah Energy", "Nawah"] },
  { canonical: "Emirates Water and Electricity Company", aliases: ["EWEC"] },
  { canonical: "Abu Dhabi Distribution Company", aliases: ["ADDC"] },
  { canonical: "AD Ports Group", aliases: ["Abu Dhabi Ports"] },
  { canonical: "Etihad Airways", aliases: ["Etihad"] },
  { canonical: "Etihad Rail" },
  { canonical: "Abu Dhabi Airports", aliases: ["Abu Dhabi Airports Company", "ADAC"] },
  { canonical: "Aldar Properties", aliases: ["Aldar"] },
  { canonical: "Modon Holding", aliases: ["Modon Properties", "Modon"] },
  { canonical: "Miral", aliases: ["Miral Experiences", "Miral Destinations"] },
  { canonical: "G42", aliases: ["Group 42"] },
  { canonical: "Core42" },
  { canonical: "Presight" },
  { canonical: "Space42" },
  { canonical: "AIQ" },
  { canonical: "Technology Innovation Institute", aliases: ["TII"] },
  { canonical: "Advanced Technology Research Council", aliases: ["ATRC"] },
  { canonical: "EDGE Group", aliases: ["EDGE"] },
  { canonical: "Tawazun Council", aliases: ["Tawazun"] },
  { canonical: "PureHealth", aliases: ["Pure Health"] },
  { canonical: "M42" },
  { canonical: "SEHA", aliases: ["Abu Dhabi Health Services Company"] },
  { canonical: "Agthia Group", aliases: ["Agthia"] },
  { canonical: "Silal" },
  { canonical: "Borouge" },
  { canonical: "Fertiglobe" },
  { canonical: "Emirates Global Aluminium", aliases: ["EGA"] },
  { canonical: "Yahsat" },
  { canonical: "First Abu Dhabi Bank", aliases: ["FAB"] },
  { canonical: "Abu Dhabi Commercial Bank", aliases: ["ADCB"] },
  { canonical: "Abu Dhabi Islamic Bank", aliases: ["ADIB"] },
  { canonical: "Abu Dhabi Global Market", aliases: ["ADGM"] },
  { canonical: "Abu Dhabi Securities Exchange", aliases: ["ADX"] },
  { canonical: "Abu Dhabi Investment Office", aliases: ["ADIO"] },
  { canonical: "Abu Dhabi Accountability Authority", aliases: ["ADAA"] },
  { canonical: "Abu Dhabi Chamber" },
  { canonical: "Abu Dhabi Customs" },
  { canonical: "Abu Dhabi Police" },
  { canonical: "Abu Dhabi Executive Office" },
  { canonical: "Department of Government Enablement", aliases: ["DGE"] },
  { canonical: "Department of Culture and Tourism Abu Dhabi", aliases: ["DCT Abu Dhabi"] },
  { canonical: "Department of Municipalities and Transport", aliases: ["DMT"] },
  { canonical: "Abu Dhabi Department of Economic Development", aliases: ["ADDED"] },
  { canonical: "Abu Dhabi Department of Finance", aliases: ["Department of Finance Abu Dhabi"] },
  { canonical: "Department of Health Abu Dhabi", aliases: ["DoH Abu Dhabi"] },
  { canonical: "Abu Dhabi Department of Education and Knowledge", aliases: ["ADEK"] },
  { canonical: "Environment Agency Abu Dhabi", aliases: ["EAD"] },
  { canonical: "Abu Dhabi National Exhibitions Company", aliases: ["ADNEC Group", "ADNEC"] },
  { canonical: "Khalifa University" },
  { canonical: "Mohamed bin Zayed University of Artificial Intelligence", aliases: ["MBZUAI"] },
  { canonical: "New York University Abu Dhabi", aliases: ["NYU Abu Dhabi", "NYUAD"] },
  { canonical: "Cleveland Clinic Abu Dhabi" },
  { canonical: "FSRA", aliases: ["Financial Services Regulatory Authority"] },
  { canonical: "IRENA", aliases: ["International Renewable Energy Agency"] },
] as const;

const LARGE_GLOBAL_SEEDS: readonly EmployerSeed[] = [
  { canonical: "e&", aliases: ["Etisalat", "Emirates Telecommunications Group"] },
  { canonical: "Emirates NBD" },
  { canonical: "HSBC" },
  { canonical: "Standard Chartered" },
  { canonical: "Citibank", aliases: ["Citi"] },
  { canonical: "JPMorgan Chase", aliases: ["J.P. Morgan", "JP Morgan"] },
  { canonical: "Deloitte" },
  { canonical: "PwC", aliases: ["PricewaterhouseCoopers"] },
  { canonical: "EY", aliases: ["Ernst & Young"] },
  { canonical: "KPMG" },
  { canonical: "Accenture" },
  { canonical: "McKinsey & Company", aliases: ["McKinsey"] },
  { canonical: "Boston Consulting Group", aliases: ["BCG"] },
  { canonical: "Bain & Company", aliases: ["Bain"] },
  { canonical: "Microsoft" },
  { canonical: "Amazon", aliases: ["Amazon Web Services", "AWS"] },
  { canonical: "Google" },
  { canonical: "IBM" },
  { canonical: "Oracle" },
  { canonical: "SAP" },
  { canonical: "Cisco" },
  { canonical: "Siemens" },
  { canonical: "Honeywell" },
  { canonical: "Schneider Electric" },
  { canonical: "GE Vernova", aliases: ["General Electric"] },
  { canonical: "SLB", aliases: ["Schlumberger"] },
  { canonical: "Baker Hughes" },
  { canonical: "Halliburton" },
  { canonical: "Weatherford" },
  { canonical: "ExxonMobil", aliases: ["Exxon Mobil"] },
  { canonical: "Shell" },
  { canonical: "TotalEnergies", aliases: ["Total Energies"] },
  { canonical: "BP" },
  { canonical: "AECOM" },
  { canonical: "AtkinsRealis", aliases: ["Atkins Realis", "Atkins"] },
  { canonical: "Parsons" },
  { canonical: "Jacobs" },
  { canonical: "WSP" },
  { canonical: "KBR" },
  { canonical: "Wood", aliases: ["Wood Group"] },
  { canonical: "Worley" },
  { canonical: "Bechtel" },
  { canonical: "RTX", aliases: ["Raytheon"] },
  { canonical: "Lockheed Martin" },
  { canonical: "Boeing" },
  { canonical: "Airbus" },
  { canonical: "Marriott International", aliases: ["Marriott"] },
  { canonical: "Hilton" },
  { canonical: "Hyatt" },
  { canonical: "InterContinental Hotels Group", aliases: ["IHG"] },
] as const;

function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:l\.?l\.?c\.?|pjsc|p\.?j\.?s\.?c\.?|plc|incorporated|inc|limited|ltd|company|co)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function directoryAliases(value: string): string[] {
  const aliases = [value];
  const parentheses = [...value.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);
  aliases.push(...parentheses);
  aliases.push(
    ...value
      .replace(/\([^)]*\)/g, "")
      .split(/\s*\/\s*/)
      .map((part) => part.trim())
      .filter(Boolean)
  );
  return aliases;
}

function uniqueSeeds(values: readonly EmployerSeed[]): EmployerSeed[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeCompanyName(value.canonical);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const GOVERNMENT_DIRECTORY_CATEGORY =
  /sovereign wealth|government departments|financial free zone|energy, oil, utilities|defense, aerospace/i;

const governmentDirectorySeeds = EMPLOYER_DIRECTORY.filter((group) =>
  GOVERNMENT_DIRECTORY_CATEGORY.test(group.category)
).flatMap((group) =>
  group.employers.map((employer) => ({
    canonical: employer.name,
    aliases: directoryAliases(employer.name),
  }))
);

const GOVERNMENT_REGISTRY = uniqueSeeds([
  ...GOVERNMENT_GRE_SEEDS,
  ...governmentDirectorySeeds,
]);
const governmentNames = new Set(
  GOVERNMENT_REGISTRY.flatMap((seed) => [seed.canonical, ...(seed.aliases || [])]).map(
    normalizeCompanyName
  )
);
const directorySeeds = EMPLOYER_DIRECTORY.flatMap((group) =>
  group.employers.map((employer) => ({
    canonical: employer.name,
    aliases: directoryAliases(employer.name),
  }))
);
const LARGE_REGISTRY = uniqueSeeds([
  ...LARGE_GLOBAL_SEEDS,
  ...directorySeeds.filter((seed) =>
    directoryAliases(seed.canonical).every(
      (alias) => !governmentNames.has(normalizeCompanyName(alias))
    )
  ),
]);

function allAliases(seed: EmployerSeed): string[] {
  return [seed.canonical, ...(seed.aliases || []), ...directoryAliases(seed.canonical)]
    .map((value) => value.trim())
    .filter(Boolean);
}

function matchesAlias(company: string, alias: string): boolean {
  // `e&` is a real Abu Dhabi employer brand, but treating `&` as generic
  // punctuation can collapse it into a one-letter alias. Match that brand as
  // an explicit raw token before applying the general normalizer.
  if (alias.trim().toLowerCase() === "e&") {
    return /^e&(?:\s|$)/i.test(company.trim());
  }
  const normalizedCompany = normalizeCompanyName(company);
  const normalizedAlias = normalizeCompanyName(alias);
  if (!normalizedCompany || !normalizedAlias) return false;
  if (normalizedCompany === normalizedAlias) return true;
  const aliasIsShortToken = !normalizedAlias.includes(" ") && normalizedAlias.length <= 5;
  if (aliasIsShortToken) {
    return normalizedCompany.split(" ").includes(normalizedAlias);
  }
  return (
    normalizedCompany.startsWith(`${normalizedAlias} `) ||
    normalizedCompany.endsWith(` ${normalizedAlias}`) ||
    normalizedCompany.includes(` ${normalizedAlias} `)
  );
}

function registryMatch(company: string, registry: readonly EmployerSeed[]): EmployerSeed | null {
  for (const seed of registry) {
    if (allAliases(seed).some((alias) => matchesAlias(company, alias))) return seed;
  }
  return null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function metadataTier(job: EmployerPriorityInput): EmployerPriorityTier {
  const sizeMin = finiteNonNegative(job.companySizeMin);
  const sizeMax = finiteNonNegative(job.companySizeMax);
  const revenue = finiteNonNegative(job.companyRevenueUsd);
  const companyType = normalizeCompanyName(job.companyType || "");
  if (/\b(?:government|public sector|state owned|government related)\b/.test(companyType)) {
    return "government-gre";
  }
  if (
    (sizeMin !== null && sizeMin >= 1_000) ||
    (sizeMax !== null && sizeMax >= 5_000) ||
    (revenue !== null && revenue >= 1_000_000_000) ||
    job.companyPubliclyTraded === true ||
    /\b(?:public|multinational|enterprise)\b/.test(companyType)
  ) {
    return "large-established";
  }
  if (
    (sizeMin !== null && sizeMin >= 200) ||
    (sizeMax !== null && sizeMax >= 500) ||
    (revenue !== null && revenue >= 100_000_000)
  ) {
    return "established";
  }
  return "other";
}

const TIER_BASE_SCORE: Record<EmployerPriorityTier, number> = {
  "government-gre": 4_000,
  "large-established": 3_000,
  established: 2_000,
  other: 1_000,
};

export function classifyEmployer(
  companyName: string,
  metadata: Omit<EmployerPriorityInput, "company"> = {}
): EmployerPriority {
  const government = registryMatch(companyName, GOVERNMENT_REGISTRY);
  const large = government ? null : registryMatch(companyName, LARGE_REGISTRY);
  const tier: EmployerPriorityTier = government
    ? "government-gre"
    : large
      ? "large-established"
      : metadataTier({ company: companyName, ...metadata });
  const size = Math.max(
    finiteNonNegative(metadata.companySizeMin) || 0,
    finiteNonNegative(metadata.companySizeMax) || 0
  );
  const revenue = finiteNonNegative(metadata.companyRevenueUsd) || 0;
  const firmographicBoost =
    (size >= 10_000 ? 260 : size >= 5_000 ? 220 : size >= 1_000 ? 180 : size >= 500 ? 120 : size >= 200 ? 80 : size >= 50 ? 30 : 0) +
    (revenue >= 1_000_000_000 ? 120 : revenue >= 100_000_000 ? 60 : 0) +
    (metadata.companyPubliclyTraded === true ? 80 : 0) +
    (metadata.directEmployer === true ? 20 : metadata.directEmployer === false ? -40 : 0);
  return {
    tier,
    score: TIER_BASE_SCORE[tier] + firmographicBoost + (government || large ? 100 : 0),
    matchedName: government?.canonical || large?.canonical || null,
  };
}

export function getEmployerPriority(job: EmployerPriorityInput): EmployerPriority {
  return classifyEmployer(job.company, job);
}

function postedTimestamp(value: string | null, now: number): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const relative = value.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
  if (!relative) return 0;
  const amount = Number(relative[1]);
  const unitMs: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
  };
  return now - amount * unitMs[relative[2].toLowerCase()];
}

const CURRENT_LISTING_WINDOW_MS = 30 * 86_400_000;

export function getJobFreshnessRank(
  job: Pick<Job, "postedAt">,
  now = Date.now()
): number {
  const timestamp = postedTimestamp(job.postedAt, now);
  // Confirmed current jobs lead. Undated legacy records remain visible, but
  // cannot outrank a listing proven to be inside the 30-day search window.
  if (timestamp === 0) return 1;
  return timestamp >= now - CURRENT_LISTING_WINDOW_MS ? 2 : 0;
}

export function compareJobsByEmployerPriority(a: Job, b: Job): number {
  const now = Date.now();
  const freshnessDifference =
    getJobFreshnessRank(b, now) - getJobFreshnessRank(a, now);
  if (freshnessDifference) return freshnessDifference;
  const priorityDifference = getEmployerPriority(b).score - getEmployerPriority(a).score;
  if (priorityDifference) return priorityDifference;
  const recencyDifference =
    postedTimestamp(b.postedAt, now) - postedTimestamp(a.postedAt, now);
  if (recencyDifference) return recencyDifference;
  return (
    a.company.localeCompare(b.company) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

function providerFilters(seeds: readonly EmployerSeed[]): EmployerProviderFilters {
  const exactNames: string[] = [];
  const partialNames: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    for (const alias of allAliases(seed)) {
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const normalized = normalizeCompanyName(alias);
      if (!normalized) continue;
      if (
        alias.trim().toLowerCase() === "e&" ||
        (!normalized.includes(" ") && normalized.length <= 5)
      ) {
        exactNames.push(alias);
      }
      else partialNames.push(alias);
    }
  }
  return {
    // TheirStack accepts large OR arrays, but keeping these bounded protects
    // the request from provider-side payload/filter limits.
    exactNames: exactNames.slice(0, 40),
    partialNames: partialNames.slice(0, 80),
  };
}

export const GOVERNMENT_GRE_COMPANY_FILTERS = providerFilters(GOVERNMENT_REGISTRY);
export const LARGE_ESTABLISHED_COMPANY_FILTERS = providerFilters(LARGE_REGISTRY);
