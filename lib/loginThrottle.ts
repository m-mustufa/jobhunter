// Slows down password guessing on /api/login. The counts live in this
// server instance's memory, so on serverless hosting it is a brake rather than
// a hard lock: it stops a quick run of guesses from one address, nothing more.

export const MAX_FAILURES = 8;
export const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED = 500;

interface Attempts {
  count: number;
  resetAt: number;
}
const attempts = new Map<string, Attempts>();

export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkThrottle(key: string, now = Date.now()): { blocked: boolean; retryAfterSeconds: number } {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return { blocked: false, retryAfterSeconds: 0 };
  return entry.count >= MAX_FAILURES
    ? { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) }
    : { blocked: false, retryAfterSeconds: 0 };
}

export function recordFailure(key: string, now = Date.now()): void {
  if (attempts.size >= MAX_TRACKED) {
    attempts.forEach((entry, tracked) => {
      if (entry.resetAt <= now) attempts.delete(tracked);
    });
  }
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

export function resetLoginThrottle(): void {
  attempts.clear();
}
