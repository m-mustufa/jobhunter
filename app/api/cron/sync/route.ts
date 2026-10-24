import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduledSync } from "@/lib/freeJobs.server";
import { runScheduledLinkedInSync } from "@/lib/linkedinListings.server";

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
    // The two lists read different sites, so they run side by side. LinkedIn
    // only reads when its saved list is several hours old, and a LinkedIn
    // failure or block never affects the career-site sync.
    const [sites, linkedin] = await Promise.allSettled([runScheduledSync(), runScheduledLinkedInSync()]);
    if (sites.status === "rejected") throw sites.reason;
    if (linkedin.status === "rejected") {
      console.warn("scheduled LinkedIn sync failed", linkedin.reason);
    }
    return NextResponse.json({
      ...sites.value,
      linkedin:
        linkedin.status === "fulfilled"
          ? linkedin.value
          : { ran: false, reason: linkedin.reason instanceof Error ? linkedin.reason.message : "failed" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sync failed.";
    console.error("scheduled sync failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
