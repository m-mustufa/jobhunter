import { isTargetManagerialTitle } from "@/lib/targetRoles";

// Matches the app's existing "past 30 days" window; raise it with
// FREE_JOBS_MAX_AGE_DAYS to also keep roles that stay open for months.
const configuredAge = Number.parseInt(process.env.FREE_JOBS_MAX_AGE_DAYS || "", 10);
export const MAX_JOB_AGE_DAYS =
  Number.isFinite(configuredAge) && configuredAge > 0 ? Math.min(configuredAge, 120) : 30;
export const MIN_DESCRIPTION_CHARS = 240;

const ABU_DHABI_PLACES =
  /\b(?:abu\s*dhabi|al\s*ain|al\s*dhafra|ruwais|mussafah|musaffah|saadiyat|yas\s+island|masdar|khalifa\s+city|al\s*reem|al\s*maryah|ghantoot|abudhabi)\b/i;
const OTHER_EMIRATES =
  /\b(?:dubai|sharjah|ajman|fujairah|ras\s+al\s+khaimah|umm\s+al\s+quwain)\b/i;
const UAE_ONLY = /\b(?:uae|united\s+arab\s+emirates)\b/i;

/**
 * Abu Dhabi (and its regions) only. A bare "UAE" location is accepted because
 * Abu Dhabi-headquartered employers often list it that way; any location that
 * names another emirate is rejected.
 */
export function isTargetLocation(location: string): boolean {
  if (!location) return false;
  if (ABU_DHABI_PLACES.test(location)) return true;
  if (OTHER_EMIRATES.test(location)) return false;
  return UAE_ONLY.test(location);
}

export function isRecent(postedAt: string | null, now = Date.now()): boolean {
  // Platforms that give no date still list only open roles, so keep them.
  if (!postedAt) return true;
  const posted = Date.parse(postedAt);
  if (!Number.isFinite(posted)) return true;
  return posted >= now - MAX_JOB_AGE_DAYS * 86_400_000;
}

// "tight" (default) keeps real management roles only. The shared title
// taxonomy also accepts generic "Senior Specialist / Senior Engineer / Officer /
// Supervisor" fallbacks, which let individual-contributor jobs through; set
// FREE_JOBS_TITLE_MODE=broad to get the taxonomy's full, looser behaviour.
const TIGHT_TITLES = process.env.FREE_JOBS_TITLE_MODE !== "broad";

// Titles that are management on their own.
const MANAGEMENT_WORD =
  /\b(?:manager|mgr|director|head|vp|avp|svp|evp|vice[\s-]+president|president|chief|gm|dgm|agm|managing|superintendent|controller|counsel|dean|provost|commissioner|governor|chairman|(?:ceo|coo|cfo|cto|cio|chro|cmo|cco|cso|cro|clo|cdo|cpo|ciso)(?!\s+office))\b/i;
// Leadership words that only count when the role is not an individual-contributor one.
const SOFT_LEAD_WORD =
  /\b(?:lead|leader|principal|technical\s+authority|company\s+secretary|corporate\s+secretary|secretary\s+general|enterprise\s+architect)\b/i;
const INDIVIDUAL_CONTRIBUTOR =
  /\b(?:engineer|developer|scientist|analyst|architect|consultant|specialist|officer|associate|supervisor|coordinator|assistant|programmer|designer|technician)\b/i;

// Entry-level and clerical titles that still contain a management-looking word
// ("Junior Legal Counsel", "Graduate Manager", "Document Controller").
const JUNIOR_TITLE =
  /\b(?:junior|jr|graduate|trainee|intern|internship|apprentice|entry[\s-]+level|document\s+controller)\b/i;

export function isTightManagerialTitle(title: string): boolean {
  if (JUNIOR_TITLE.test(title)) return false;
  if (MANAGEMENT_WORD.test(title)) return true;
  return SOFT_LEAD_WORD.test(title) && !INDIVIDUAL_CONTRIBUTOR.test(title);
}

// Sitemap sources (SuccessFactors) give no location in their list, but their
// job URLs read "<place>-<title>" ("Abu-Dhabi-Senior-Manager...", "ARE-...",
// "Dubai-..."). That is enough to skip jobs clearly elsewhere without
// downloading their pages; the real location is still checked afterwards.
function slugMayBeTargetLocation(slugText: string): boolean {
  if (ABU_DHABI_PLACES.test(slugText)) return true;
  if (OTHER_EMIRATES.test(slugText)) return false;
  return /\bARE\b/.test(slugText) || UAE_ONLY.test(slugText);
}

/** Cheap pre-filter run on the list data, before any description is downloaded. */
export function passesListCriteria(
  candidate: { title: string; location: string; postedAt: string | null },
  options: { skipLocation?: boolean } = {}
): boolean {
  return (
    isTargetManagerialTitle(candidate.title) &&
    (!TIGHT_TITLES || isTightManagerialTitle(candidate.title)) &&
    (options.skipLocation
      ? slugMayBeTargetLocation(candidate.title)
      : isTargetLocation(candidate.location)) &&
    isRecent(candidate.postedAt)
  );
}
