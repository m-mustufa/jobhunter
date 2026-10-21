import { NextResponse } from "next/server";
import { getSavedFreeJobs } from "@/lib/freeJobs.server";

// A single listing's full description, for when a job is opened or tailored.
// Reads the saved listings only; it never contacts an employer's career site.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "A job id is required." }, { status: 400 });
  }
  const job = (await getSavedFreeJobs()).find((candidate) => candidate.id === id);
  if (!job?.description) {
    return NextResponse.json(
      { error: "That listing is no longer saved. Refresh the listings and try again." },
      { status: 404 }
    );
  }
  return NextResponse.json({ description: job.description });
}
