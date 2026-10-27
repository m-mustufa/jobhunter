import { NextResponse } from "next/server";
import { SYSTEM, buildPrompt } from "@/lib/analyzeJob";
import { sanitizeProfile } from "@/lib/profile";

// Builds the exact same prompt the paid "Tailor CV for this job" flow sends
// to Claude — but never calls Claude itself, so this costs nothing. Used by
// the free Claude Desktop flow: the client opens this text in Claude, then
// pastes the reply back into /api/analyze/import to finish the job.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { job, profile } = body || {};
  if (!job || !profile) {
    return NextResponse.json(
      { error: "Both a job and a profile are required." },
      { status: 400 }
    );
  }

  // The same check the import route makes: a prompt built from a vacancy with
  // no text would send Claude nothing to tailor against.
  if (
    typeof job.title !== "string" ||
    !job.title.trim() ||
    typeof job.description !== "string" ||
    !job.description.trim()
  ) {
    return NextResponse.json(
      { error: "The target job and its full description are required." },
      { status: 400 }
    );
  }

  const candidateProfile = sanitizeProfile(profile);
  const prompt = `${SYSTEM}\n\n${buildPrompt(job, candidateProfile, {
    requestWebResearch: process.env.ROLE_RESEARCH_ENABLED !== "false",
  })}`;
  return NextResponse.json({ prompt });
}
