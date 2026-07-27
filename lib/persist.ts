// Thin localStorage helpers, guarded for SSR (Next.js renders this module
// server-side too, where `window` doesn't exist).

// Shared across app/page.tsx and app/profile/page.tsx so the two routes
// read/write the same persisted state.
export const MASTER_CV_KEY = "jobhunter:masterCV";
export const PROFILE_KEY = "jobhunter:profile";
export const JOBS_CACHE_KEY = "jobhunter:jobsCache";

export function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable (private browsing) — not critical, skip.
  }
}
