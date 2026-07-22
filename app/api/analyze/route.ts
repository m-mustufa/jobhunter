import { NextResponse } from "next/server";
import { analyzeJobForCandidate } from "@/lib/analyzeJob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { job, masterCV } = body || {};
  if (!job || !masterCV) {
    return NextResponse.json(
      { error: "Both a job and a master CV are required." },
      { status: 400 }
    );
  }

  const analysis = await analyzeJobForCandidate(job, masterCV);
  return NextResponse.json(analysis);
}
