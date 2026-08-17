// Thin localStorage helpers, guarded for SSR (Next.js renders this module
// server-side too, where `window` doesn't exist).

// Shared across app/page.tsx and app/profile/page.tsx so the two routes
// read/write the same persisted state.
export const MASTER_CV_KEY = "jobhunter:masterCV";
export const PROFILE_KEY = "jobhunter:profile";
// Provider-versioned so an old JSearch snapshot cannot be mistaken for a
// Hirebase response after the normal listing provider is switched.
// v2 invalidates browser snapshots from the old static-sample fallback.
export const JOBS_CACHE_KEY = "jobhunter:jobsCache:hirebase:v2";
// Provider-versioned so a failed TheirStack comparison never silently falls
// back to stale cards from the retired public LinkedIn crawler.
export const LINKEDIN_JOBS_CACHE_KEY = "jobhunter:linkedinJobsCache:theirstack:v1";
export const JOB_LISTINGS_CLEARED_KEY = "jobhunter:jobListingsCleared:v1";
export const TAILORED_ANALYSES_KEY = "jobhunter:tailoredAnalyses:v1";
export const APPLIED_JOBS_KEY = "jobhunter:appliedJobs:v1";

export function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Returns whether the write actually succeeded — callers that need the user
// to know about data loss (e.g. the Profile page) should check this instead
// of assuming a save always works. Quota-exceeded and private-browsing
// failures throw synchronously from setItem, so this is the only place that
// can detect them.
export function saveJSON(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`saveJSON: failed to write "${key}"`, err);
    return false;
  }
}

export function removeJSON(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.error(`removeJSON: failed to remove "${key}"`, err);
    return false;
  }
}

export function markSavedJobListingsCleared(): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(JOBS_CACHE_KEY);
    window.localStorage.removeItem(LINKEDIN_JOBS_CACHE_KEY);
    window.localStorage.removeItem("jobhunter:jobsCache");
    window.localStorage.setItem(JOB_LISTINGS_CLEARED_KEY, JSON.stringify(Date.now()));
    return true;
  } catch (err) {
    console.error("Could not clear the browser job-listing caches", err);
    return false;
  }
}
