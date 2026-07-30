// Thin localStorage helpers, guarded for SSR (Next.js renders this module
// server-side too, where `window` doesn't exist).

// Shared across app/page.tsx and app/profile/page.tsx so the two routes
// read/write the same persisted state.
export const MASTER_CV_KEY = "jobhunter:masterCV";
export const PROFILE_KEY = "jobhunter:profile";
export const JOBS_CACHE_KEY = "jobhunter:jobsCache";
export const TAILORED_ANALYSES_KEY = "jobhunter:tailoredAnalyses:v1";

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
