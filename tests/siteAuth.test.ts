import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as login } from "@/app/api/login/route";
import { config, middleware } from "@/middleware";
import { MAX_FAILURES, WINDOW_MS, checkThrottle, recordFailure, resetLoginThrottle } from "@/lib/loginThrottle";
import { AUTH_COOKIE, checkSession, safeEqual, sessionToken } from "@/lib/siteAuth";

// The site-wide password gate: the cookie it sets, the middleware that checks
// it on every page and API route, and the brake on password guessing.

const PASSWORD = "correct horse battery";

beforeEach(() => {
  vi.stubEnv("SITE_PASSWORD", PASSWORD);
  resetLoginThrottle();
});
afterEach(() => vi.unstubAllEnvs());

describe("sessionToken and safeEqual", () => {
  it("makes a stable token that is not the password", async () => {
    const token = await sessionToken(PASSWORD);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(PASSWORD);
    expect(await sessionToken(PASSWORD)).toBe(token);
    expect(await sessionToken(`${PASSWORD}!`)).not.toBe(token);
  });

  it("compares strings exactly, whatever their length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("pässword", "pässword")).toBe(true);
  });

  it("tells a token cookie, an old password cookie and anything else apart", async () => {
    expect(await checkSession(await sessionToken(PASSWORD), PASSWORD)).toBe("valid");
    expect(await checkSession(PASSWORD, PASSWORD)).toBe("legacy");
    expect(await checkSession("nope", PASSWORD)).toBe("invalid");
    expect(await checkSession("", PASSWORD)).toBe("invalid");
    expect(await checkSession(undefined, PASSWORD)).toBe("invalid");
    // A token made from a different password is not accepted.
    expect(await checkSession(await sessionToken("other"), PASSWORD)).toBe("invalid");
  });
});

describe("POST /api/login", () => {
  let ipCounter = 0;
  const attempt = (password: unknown, ip = `10.0.0.${++ipCounter}`) =>
    login(
      new Request("http://localhost/api/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: typeof password === "string" && password.startsWith("{") ? password : JSON.stringify({ password }),
      })
    );

  it("signs in with the right password and sets a token cookie, not the password", async () => {
    const res = await attempt(PASSWORD);
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(AUTH_COOKIE);
    expect(cookie?.value).toBe(await sessionToken(PASSWORD));
    expect(cookie?.value).not.toBe(PASSWORD);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("refuses a wrong password and sets no cookie", async () => {
    const res = await attempt("wrong");
    expect(res.status).toBe(401);
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
    expect((await res.json()).error).toBe("Incorrect password.");
  });

  it.each([
    ["a password that is not text", 12345],
    ["no password", undefined],
    ["a null password", null],
  ])("refuses %s", async (_label, value) => {
    expect((await attempt(value)).status).toBe(401);
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await attempt("{nope")).status).toBe(400);
  });

  it("lets everyone in when no password is configured", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    const res = await attempt("anything");
    expect(res.status).toBe(200);
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });

  it("stops accepting guesses from an address after too many wrong ones, even the right password", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      expect((await attempt("wrong", ip)).status).toBe(401);
    }
    const blocked = await attempt(PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatch(/Too many wrong passwords/);
    expect(blocked.cookies.get(AUTH_COOKIE)).toBeUndefined();

    // Someone else is not affected.
    expect((await attempt(PASSWORD, "203.0.113.10")).status).toBe(200);
  });

  it("forgets earlier wrong guesses after a correct sign-in", async () => {
    const ip = "203.0.113.20";
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) await attempt("wrong", ip);
    expect((await attempt(PASSWORD, ip)).status).toBe(200);
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
      expect((await attempt("wrong", ip)).status).toBe(401);
    }
  });
});

describe("login throttle", () => {
  it("blocks at the limit and lifts when the window has passed", () => {
    const start = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("a", start);
    expect(checkThrottle("a", start + 1000).blocked).toBe(true);
    expect(checkThrottle("a", start + 1000).retryAfterSeconds).toBeGreaterThan(0);
    expect(checkThrottle("a", start + WINDOW_MS).blocked).toBe(false);
    expect(checkThrottle("other", start).blocked).toBe(false);
  });
});

describe("middleware", () => {
  const at = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie: `${AUTH_COOKIE}=${cookie}` } } : undefined);
  const isRedirectToLogin = (res: Response) =>
    res.status === 307 && new URL(res.headers.get("location") || "").pathname === "/login";
  const letsThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

  it("lets every request through when no password is configured", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    expect(letsThrough(await middleware(at("/api/jobs")))).toBe(true);
  });

  it("sends a visitor with no cookie, or a wrong one, to the login page", async () => {
    for (const path of ["/", "/profile", "/api/jobs", "/api/analyze/import"]) {
      expect(isRedirectToLogin(await middleware(at(path))), path).toBe(true);
    }
    expect(isRedirectToLogin(await middleware(at("/", "guess")))).toBe(true);
  });

  it("lets a visitor with the token cookie through without touching the cookie", async () => {
    const res = await middleware(at("/api/jobs", await sessionToken(PASSWORD)));
    expect(letsThrough(res)).toBe(true);
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });

  it("keeps someone with an old password cookie signed in and swaps it for a token", async () => {
    const res = await middleware(at("/", PASSWORD));
    expect(letsThrough(res)).toBe(true);
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe(await sessionToken(PASSWORD));
  });

  it("locks a cookie made for another password out", async () => {
    expect(isRedirectToLogin(await middleware(at("/", await sessionToken("an older password"))))).toBe(true);
  });

  it("gates every page and API route except login, the cron sync and static files", () => {
    // Next compiles the matcher with path-to-regexp; this pattern is plain regex.
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/", "/profile", "/applied", "/employers", "/api/jobs", "/api/profile", "/api/analyze/import"]) {
      expect(pattern.test(path), path).toBe(true);
    }
    for (const path of ["/login", "/api/login", "/api/cron/sync", "/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/icon.svg"]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });
});
