import { NextResponse } from "next/server";
import { JobsResponse } from "@/lib/types";
import { SAMPLE_JOBS } from "@/lib/sampleJobs";
import {
  clearHirebaseJobsMemoryCache,
  fetchHirebaseJobs,
} from "@/lib/hirebaseJobs.server";
import { clearJobListingSnapshots } from "@/lib/jobListingStore.server";
// Legacy public LinkedIn guest-page crawler is intentionally disabled while
// we compare the licensed TheirStack feed. Keep this line for easy rollback:
// import { fetchLinkedInJobDescription, fetchLinkedInJobs } from "@/lib/linkedinJobs.server";
import {
  clearLinkedInJobsMemoryCache,
  fetchLinkedInJobs,
} from "@/lib/theirStackLinkedInJobs.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sampleJobs(keyword: string) {
  return keyword
    ? SAMPLE_JOBS.filter((job) =>
        `${job.title} ${job.company} ${job.description}`.toLowerCase().includes(keyword)
      )
    : SAMPLE_JOBS;
}

function formatSyncWait(nextSyncAt: number | null): string {
  if (!nextSyncAt) return "later";
  const remainingMinutes = Math.max(
    1,
    Math.ceil((nextSyncAt - Date.now()) / 60_000)
  );
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Type Confirm to clear saved listings." }, { status: 400 });
  }

  const confirmation =
    body && typeof body === "object" && "confirmation" in body
      ? (body as { confirmation?: unknown }).confirmation
      : null;
  if (confirmation !== "Confirm") {
    return NextResponse.json({ error: "Type Confirm exactly to clear saved listings." }, { status: 400 });
  }

  // Invalidate process memory before deleting the durable snapshots so an
  // already-running refresh cannot repopulate the store after this reset.
  try {
    await Promise.all([
      clearHirebaseJobsMemoryCache(),
      clearLinkedInJobsMemoryCache(),
    ]);
    await clearJobListingSnapshots();
    return NextResponse.json({
      ok: true,
      note: "Saved listings cleared. Click Refresh listings to fetch fresh jobs; the LinkedIn 12-hour credit cooldown still applies.",
    });
  } catch (error) {
    console.error("Could not clear saved job listings", error);
    return NextResponse.json(
      { error: "Saved listings could not be cleared. Please try again." },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = (searchParams.get("keyword") || "").trim().toLowerCase();
  const source = searchParams.get("source");
  const forceRefresh = searchParams.get("refresh") === "1";

  if (source === "linkedin" && searchParams.has("jobId")) {
    return NextResponse.json(
      { error: "TheirStack listings already include the full job description. Refresh the listing first." },
      { status: 400 }
    );
  }

  // LinkedIn mode is deliberately isolated from the existing Hirebase/sample
  // path. If LinkedIn is unavailable, never put mixed-source results under a
  // "LinkedIn only" toggle.
  if (source === "linkedin") {
    try {
      const result = await fetchLinkedInJobs(forceRefresh);
      const jobs = keyword
        ? result.jobs.filter((job) =>
            `${job.title} ${job.company} ${job.description}`.toLowerCase().includes(keyword)
          )
        : result.jobs;

      const notes: string[] = [];
      if (result.syncMode === "stale") {
        notes.push(
          `TheirStack sync failed — showing ${result.jobs.length} saved LinkedIn listings. Nothing was removed, but credit use for the failed attempt could not be confirmed.`
        );
      } else if (result.syncMode === "cooldown") {
        notes.push(
          `Already synced or attempted recently — 0 credits used. Next live LinkedIn sync in ${formatSyncWait(result.nextSyncAt)}. ${result.jobs.length} saved listings are available.`
        );
      } else if (result.syncMode === "empty") {
        notes.push(
          "No saved LinkedIn listings. Click Refresh listings to run the first sync (up to 70 credits)."
        );
      } else if (result.syncMode === "saved") {
        notes.push(
          `Showing ${result.jobs.length} saved LinkedIn listings — 0 credits used.`
        );
      } else if (result.failedSearches > 0) {
        notes.push(
          `Synced ${result.apiRecordsReturned ?? 0} returned LinkedIn records and added ${result.newJobsCount ?? 0} new. ${result.failedSearches} of ${result.attemptedSearches} requests failed, so final credit use could not be confirmed. ${result.jobs.length} listings are saved.`
        );
      } else {
        const creditsUsed = result.apiRecordsReturned ?? 0;
        notes.push(
          `Synced ${creditsUsed} LinkedIn records (${creditsUsed} credits used), added ${result.newJobsCount ?? 0} new, and kept ${result.jobs.length} saved listings.`
        );
      }
      if (result.descriptionFailures > 0) {
        notes.push(`${result.descriptionFailures} TheirStack records without descriptions were skipped.`);
      }
      if (keyword && jobs.length === 0) {
        notes.push("No LinkedIn jobs matched the current keyword.");
      }

      const response: JobsResponse = {
        jobs,
        sample: false,
        note: notes.join(" "),
        ...(result.syncedAt ? { providerSyncedAt: result.syncedAt } : {}),
        ...(result.nextSyncAt
          ? { nextProviderSyncAt: result.nextSyncAt }
          : {}),
      };
      return NextResponse.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "TheirStack could not be reached";
      const providerWasNotContacted =
        message.includes("no provider request was made") ||
        message.includes("THEIRSTACK_API_KEY is not configured") ||
        message.includes("TheirStack is disabled while DEMO_MODE is on");
      const response: JobsResponse = {
        jobs: [],
        sample: false,
        error: message,
        note: providerWasNotContacted
          ? `LinkedIn jobs via TheirStack could not be loaded (${message}). Existing listings were not changed; no provider request was sent and 0 credits were used.`
          : `LinkedIn jobs via TheirStack could not be loaded (${message}). Existing listings were not changed, and credit use for this failed attempt could not be confirmed.`,
      };
      return NextResponse.json(response, { status: 502 });
    }
  }

  // DEMO_MODE is the only unconditional sample path. Without a provider key,
  // fetchHirebaseJobs still gets the chance to restore a private snapshot;
  // samples are used only when neither a key nor saved real data exists.
  if (process.env.DEMO_MODE === "true") {
    const res: JobsResponse = {
      jobs: sampleJobs(keyword),
      sample: true,
      note: "Showing sample jobs — DEMO_MODE is on.",
    };
    return NextResponse.json(res);
  }

  try {
    const result = await fetchHirebaseJobs(forceRefresh);
    let jobs = result.jobs;
    if (keyword) {
      jobs = jobs.filter((job) =>
        `${job.title} ${job.company} ${job.description}`.toLowerCase().includes(keyword)
      );
    }

    if (result.jobs.length === 0) {
      throw new Error("Hirebase returned no usable Abu Dhabi jobs");
    }

    const notes: string[] = [];
    if (result.stale) {
      notes.push(
        `Hirebase is temporarily unavailable — showing ${result.jobs.length} saved listings.`
      );
    } else if (result.fromCache) {
      notes.push(`Showing ${result.jobs.length} saved Abu Dhabi listings.`);
    } else {
      notes.push(
        `Refresh checked ${result.fetchedJobsCount ?? 0} current Hirebase jobs and added ${result.newJobsCount ?? 0} new. ${result.jobs.length} saved listings are available.`
      );
    }
    if (result.failedSearches > 0) {
      notes.push(
        `${result.failedSearches} of ${result.attemptedSearches} Hirebase title groups could not be completed.`
      );
    }
    if (keyword && jobs.length === 0) {
      notes.push("No Hirebase jobs matched the current keyword.");
    }

    const res: JobsResponse = {
      jobs,
      sample: false,
      note: notes.join(" "),
    };
    return NextResponse.json(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hirebase could not be reached";
    if (message === "HIREBASE_API_KEY is not configured") {
      const res: JobsResponse = {
        jobs: sampleJobs(keyword),
        sample: true,
        note: "Showing sample jobs. Add HIREBASE_API_KEY to pull live listings.",
      };
      return NextResponse.json(res);
    }
    const res: JobsResponse = {
      jobs: [],
      sample: false,
      error: message,
      note: `Hirebase jobs could not be loaded (${message}). Your last saved live listings were not changed.`,
    };
    return NextResponse.json(res, { status: 502 });
  }
}
