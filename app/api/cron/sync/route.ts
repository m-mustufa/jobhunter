import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduledSync } from "@/lib/freeJobs.server";

// Called on a schedule (see .github/workflows/sync-jobs.yml) so the saved list
// is refreshed while nobody has the app open. It sits outside the site-password
// gate (middleware.ts), so it proves itself with a shared secret instead.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  try {
    return NextResponse.json(await runScheduledSync());
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sync failed.";
    console.error("scheduled sync failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
