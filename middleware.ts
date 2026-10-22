import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "jh_auth";

export function middleware(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  // No password configured — don't lock anyone out of a misconfigured deploy.
  if (!sitePassword) return NextResponse.next();

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie === sitePassword) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Gate every page and every API route (the API routes are exactly what
  // costs money) except the login page itself, the login submit endpoint,
  // static assets, and the scheduled sync, which checks its own secret.
  matcher: ["/((?!login|api/login|api/cron|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
