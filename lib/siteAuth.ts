// Shared by the middleware (Edge runtime) and the login route (Node), so it
// uses only Web APIs: TextEncoder and crypto.subtle.

export const AUTH_COOKIE = "jh_auth";
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

/**
 * What the login cookie holds. It is derived from the site password but is not
 * the password, so the cookie value never gives the password away. Anyone with
 * the cookie is let in until the password changes, exactly as before.
 */
export async function sessionToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`jobhunter-session:${password}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings without stopping at the first difference. */
export function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export type SessionCheck = "valid" | "legacy" | "invalid";

/**
 * "legacy" is a cookie issued before the token existed (it holds the password
 * itself). It is still accepted so nobody is logged out by the change, and the
 * middleware swaps it for a token on the same request.
 */
export async function checkSession(cookie: string | undefined, password: string): Promise<SessionCheck> {
  if (!cookie) return "invalid";
  if (safeEqual(cookie, await sessionToken(password))) return "valid";
  if (safeEqual(cookie, password)) return "legacy";
  return "invalid";
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  };
}
