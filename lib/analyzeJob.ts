import { Analysis, Job, TailoredCVContent } from "./types";
import { buildDemoAnalysis } from "./demoAnalysis";
import { getMatchTier } from "./matchTier";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const SYSTEM = `You are an expert technical recruiter and CV writer running a strict, repeatable pipeline for one candidate against one vacancy.

For every vacancy you must:
1. Read the full job description.
2. Identify mandatory and preferred requirements separately.
3. Match those requirements against the candidate's master CV.
4. Select the most relevant experiences and achievements from the master CV.
5. Adjust the professional summary to speak to this specific role.
6. Reorder skills based on relevance to this role.
7. Reorder achievements and projects based on relevance.
8. Use truthful job-description keywords only where they are genuinely supported by the master CV.
9. Remove or reduce content that is irrelevant to this role.
10. Produce a short gap analysis: what the role wants that the master CV does not clearly support.
11. Maintain an audit trail: for every non-trivial claim in the tailored CV, note which part of the master CV it comes from.

You tailor CVs TRUTHFULLY. You may re-order, re-emphasize, rephrase, and select
from the candidate's real experience to match a specific job. You must NEVER
invent employers, job titles, dates, degrees, skills, responsibilities, or
achievements that are not present in the master CV. If the candidate lacks
something the job wants, do not fabricate it — say so in the gap analysis and
simply lead with their genuine strengths in the CV itself.

Return ONLY a valid JSON object. No markdown fences, no preamble.`;

function buildPrompt(job: Pick<Job, "title" | "company" | "location" | "description">, masterCV: string) {
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
  "tailoredCV": {
    "summary": "<2-4 sentence professional summary tailored to THIS job, truthful, drawn only from the master CV>",
    "skills": ["<skills from the master CV, reordered so the most relevant to THIS job come first>"],
    "experience": [
      {
        "company": "<employer, exactly as in the master CV>",
        "role": "<title, exactly as in the master CV>",
        "dates": "<dates, exactly as in the master CV>",
        "bullets": ["<achievement/responsibility bullets from that role, reworded and reordered for relevance to THIS job, truthful and only from the master CV>"]
      }
    ],
    "education": ["<education/earlier-career lines from the master CV, kept brief, or an empty array if none>"]
  },
  "coverLetter": "<a short, specific cover-letter BODY (120-180 words, 2-3 paragraphs) in a natural human voice, no clichés — do NOT include a greeting/salutation or a sign-off, those are added separately>",
  "gapAnalysis": "<2-4 sentences: what this role wants that the master CV does not clearly support, stated plainly>",
  "auditTrail": [{"statement": "<a specific claim made in the tailored CV>", "source": "<the master CV section/line/experience it is drawn from>"}]
}

Return only the JSON object.`;
}

function toTailoredCV(raw: any): TailoredCVContent {
  const experience = Array.isArray(raw?.experience)
    ? raw.experience.map((e: any) => ({
        company: String(e?.company || ""),
        role: String(e?.role || ""),
        dates: String(e?.dates || ""),
        bullets: Array.isArray(e?.bullets) ? e.bullets.map(String) : [],
      }))
    : [];
  return {
    summary: String(raw?.summary || ""),
    skills: Array.isArray(raw?.skills) ? raw.skills.map(String) : [],
    experience,
    education: Array.isArray(raw?.education) ? raw.education.map(String) : [],
  };
}

function toAnalysis(parsed: any): Analysis {
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  const tier = getMatchTier(score);
  return {
    score,
    tier: tier.key,
    tierLabel: tier.label,
    verdict: String(parsed.verdict || ""),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
    tailoredCV: toTailoredCV(parsed.tailoredCV),
    coverLetter: String(parsed.coverLetter || ""),
    gapAnalysis: String(parsed.gapAnalysis || ""),
    auditTrail: Array.isArray(parsed.auditTrail)
      ? parsed.auditTrail.map((e: any) => ({
          statement: String(e?.statement || ""),
          source: String(e?.source || ""),
        }))
      : [],
  };
}

export async function analyzeJobForCandidate(
  job: Pick<Job, "title" | "company" | "location" | "description" | "id">,
  masterCV: string
): Promise<Analysis> {
  const key = process.env.ANTHROPIC_API_KEY;

  if (process.env.DEMO_MODE === "true" || !key) {
    return buildDemoAnalysis(job as Job, masterCV, "Simulated preview — Claude was not called.");
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
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(job, masterCV) }],
      }),
    });

    if (!r.ok) {
      return buildDemoAnalysis(job as Job, masterCV, "Simulated preview — Claude is currently unavailable.");
    }

    const data = await r.json();
    const text: string = (data.content || [])
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    const clean = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(clean);
    return toAnalysis(parsed);
  } catch {
    return buildDemoAnalysis(job as Job, masterCV, "Simulated preview — live AI analysis could not be completed.");
  }
}
