import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "jh_auth";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: Request) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    // Fail open only if the operator hasn't configured a password at all —
    // otherwise a misconfigured deploy would lock everyone out permanently.
    return NextResponse.json({ ok: true });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (body?.password !== sitePassword) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, sitePassword, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
