import { NextResponse } from "next/server";
import { AUTH_COOKIE, authCookieOptions, safeEqual, sessionToken } from "@/lib/siteAuth";
import { checkThrottle, clearFailures, clientKey, recordFailure } from "@/lib/loginThrottle";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    // Fail open only if the operator hasn't configured a password at all —
    // otherwise a misconfigured deploy would lock everyone out permanently.
    return NextResponse.json({ ok: true });
  }

  const key = clientKey(req);
  const throttle = checkThrottle(key);
  if (throttle.blocked) {
    const minutes = Math.ceil(throttle.retryAfterSeconds / 60);
    return NextResponse.json(
      { error: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof body?.password !== "string" || !safeEqual(body.password, sitePassword)) {
    recordFailure(key);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  clearFailures(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await sessionToken(sitePassword), authCookieOptions());
  return res;
}
