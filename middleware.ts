import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authCookieOptions, checkSession, sessionToken } from "@/lib/siteAuth";

export async function middleware(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  // No password configured — don't lock anyone out of a misconfigured deploy.
  if (!sitePassword) return NextResponse.next();

  const session = await checkSession(req.cookies.get(AUTH_COOKIE)?.value, sitePassword);
  if (session === "valid") return NextResponse.next();
  if (session === "legacy") {
    // Signed in before the cookie held a token instead of the password: let them
    // through and replace the cookie, so nobody has to sign in again.
    const response = NextResponse.next();
    response.cookies.set(AUTH_COOKIE, await sessionToken(sitePassword), authCookieOptions());
    return response;
  }

  const loginUrl = new URL("/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Gate every page and every API route (the API routes are exactly what
  // costs money) except the login page itself, the login submit endpoint,
  // static assets, and the scheduled sync, which checks its own secret.
  matcher: ["/((?!login|api/login|api/cron|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
