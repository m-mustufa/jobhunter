import { NextResponse } from "next/server";
import { getSavedFreeJobs } from "@/lib/freeJobs.server";
import { getJobRecommendation } from "@/lib/jobRecommendation";
import { sanitizeProfile } from "@/lib/profile";

// The "Recommended" marker is scored from each job's full description. The
// list sent to the browser has no descriptions, so the scoring runs here, with
// the exact same function, and only the small result goes back.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body?.profile || typeof body.profile !== "object") {
    return NextResponse.json({ error: "A profile is required." }, { status: 400 });
  }

  const profile = sanitizeProfile({ ...body.profile, photo: "" });
  const recommendations: Record<string, { score: number; recommended: boolean }> = {};
  for (const job of await getSavedFreeJobs()) {
    recommendations[job.id] = getJobRecommendation(profile, job);
  }
  return NextResponse.json({ recommendations });
}
