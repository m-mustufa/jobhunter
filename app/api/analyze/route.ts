import { NextResponse } from "next/server";
import { analyzeJobForCandidate, LiveAnalysisError } from "@/lib/analyzeJob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  try {
    const analysis = await analyzeJobForCandidate(job, profile);
    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Live CV tailoring failed", error);
    const status = error instanceof LiveAnalysisError ? error.status : 500;
    const message =
      error instanceof LiveAnalysisError
        ? error.message
        : "Live tailoring failed. Please try again.";
    return NextResponse.json({ error: message }, { status });
  }
}
