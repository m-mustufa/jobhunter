import { NextResponse } from "next/server";
import {
  LiveAnalysisError,
  parseModelResponse,
  toValidatedAnalysis,
} from "@/lib/analyzeJob";
import { sanitizeProfile } from "@/lib/profile";

// Parses a response the user pasted back from claude.ai (see
// /api/analyze/prompt) into the same Analysis shape the paid tailoring call
// produces — reusing the exact same validation/cleanup logic (role-mashup
// guard, summary-length enforcement) so the result is indistinguishable
// downstream. Never calls Claude, so this costs nothing either.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { text, profile, job } = body || {};
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { error: "Paste Claude's reply before importing." },
      { status: 400 }
    );
  }
  if (!profile) {
    return NextResponse.json({ error: "Profile is required." }, { status: 400 });
  }
  if (
    !job ||
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
  const targetJob = {
    title: job.title.trim(),
    company: typeof job.company === "string" ? job.company.trim() : "",
    description: job.description.trim(),
  };
  try {
    const parsed = parseModelResponse(text);
    const analysis = toValidatedAnalysis(parsed, candidateProfile, targetJob);
    return NextResponse.json(analysis);
  } catch (error: any) {
    console.error("Failed to import a pasted claude.ai response", error);
    const status = error instanceof LiveAnalysisError ? error.status : 400;
    const message =
      error instanceof LiveAnalysisError
        ? error.message
        : error instanceof Error && error.message
          ? `Couldn't read that as a valid response: ${error.message}`
          : "That doesn't look like a valid response — make sure you copied Claude's entire reply, including the opening { and closing }.";
    return NextResponse.json({ error: message }, { status });
  }
}
