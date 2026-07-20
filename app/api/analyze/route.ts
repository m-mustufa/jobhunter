import { NextResponse } from "next/server";
import { Analysis } from "@/lib/types";
import { buildDemoAnalysis } from "@/lib/demoAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const SYSTEM = `You are an expert technical recruiter and CV writer.

You tailor CVs TRUTHFULLY. You may re-order, re-emphasize, rephrase, and select
from the candidate's real experience to match a specific job. You must NEVER
invent employers, job titles, dates, degrees, skills, or achievements that are
not present in the master CV. If the candidate lacks something the job wants,
do not fabricate it — simply lead with their genuine strengths.

Return ONLY a valid JSON object. No markdown fences, no preamble.`;

function buildPrompt(job: any, masterCV: string) {
  return `A candidate is considering this job.

JOB TITLE: ${job.title}
COMPANY: ${job.company}
LOCATION: ${job.location || "n/a"}
JOB DESCRIPTION:
${job.description}

CANDIDATE MASTER CV:
${masterCV}

Do the following and return a single JSON object with exactly these keys:
{
  "score": <integer 0-100, how well the candidate fits this job>,
  "verdict": "<one short sentence, e.g. 'Strong fit — lead with SaaS + React'>",
  "reasons": ["<3-5 short bullet reasons behind the score, matches and gaps>"],
  "tailoredCV": "<the candidate's CV, rewritten in Markdown, tailored to THIS job — truthful, re-emphasized, keyword-aligned to the description>",
  "coverLetter": "<a short, specific cover letter (120-180 words) in a natural human voice, no clichés>"
}

Return only the JSON object.`;
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;

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

  if (process.env.DEMO_MODE === "true" || !key) {
    return NextResponse.json(
      buildDemoAnalysis(job, masterCV, "Simulated preview — Claude was not called.")
    );
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(job, masterCV) }],
      }),
    });

    if (!r.ok) {
      return NextResponse.json(
        buildDemoAnalysis(job, masterCV, "Simulated preview — Claude is currently unavailable.")
      );
    }

    const data = await r.json();
    const text: string = (data.content || [])
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    const clean = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(clean);

    const analysis: Analysis = {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      verdict: String(parsed.verdict || ""),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
      tailoredCV: String(parsed.tailoredCV || ""),
      coverLetter: String(parsed.coverLetter || ""),
    };

    return NextResponse.json(analysis);
  } catch (err: any) {
    return NextResponse.json(
      buildDemoAnalysis(job, masterCV, "Simulated preview — live AI analysis could not be completed.")
    );
  }
}
