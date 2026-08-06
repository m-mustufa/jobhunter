import { Analysis, Job, Profile, TailoredCVContent } from "./types";
import { buildDemoAnalysis } from "./demoAnalysis";
import { buildMasterCVMarkdown } from "./masterCV";
import { getMatchTier } from "./matchTier";
import { canonicalizeExperienceCompanyName, sanitizeProfile } from "./profile";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// 429 (rate-limited) is retried too, not just 5xx/529 — a rate-limit
// response is exactly the kind of transient condition retrying resolves,
// and previously it went straight to failure with no retry at all.
const TRANSIENT_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 529]);
const SUMMARY_MIN_CHARS = 1050;
const SUMMARY_MAX_CHARS = 1100;
const MODEL_PERFORMANCE_OPTIONS = MODEL.startsWith("claude-sonnet-5")
  ? {
      // CV tailoring is a bounded rewriting task. Medium effort with thinking
      // disabled keeps Sonnet's writing quality while avoiding a long hidden
      // reasoning phase before it starts producing the JSON response.
      output_config: { effort: "medium" },
      thinking: { type: "disabled" },
    }
  : {};

export class LiveAnalysisError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "LiveAnalysisError";
    this.status = status;
  }
}

// Conservative by design: skills, education, company labels, and dates are
// copied from the candidate's Profile. The model may lightly rephrase a role
// label and a chosen subset of its bullets, but it cannot replace the real
// employer, chronology, or underlying work.
// Exported so the free "tailor via claude.ai" flow (app/api/analyze/prompt)
// can build the exact same prompt without duplicating it — the only
// difference between the paid and free paths is who sends this text to
// Claude and how the JSON response comes back.
export const SYSTEM = `You are an expert technical recruiter and CV writer running a strict, repeatable pipeline for one candidate against one vacancy.

You are given the candidate's fixed CV data (employers, dates, skills, and education are NOT yours to change) and must produce only:
1. A tailored professional summary for this specific role.
2. For every employer, an optional truthful rephrasing of the existing position label, the 3-4 strongest existing bullets rewritten for this role and placed first, then every remaining original bullet ranked by relevance.
3. A score/verdict/reasons/audit-trail assessment of fit.
4. A cover letter body.

You tailor TRUTHFULLY. You may rephrase and re-emphasize the candidate's real
achievements to match a specific job. You must NEVER invent employers, job
functions, seniority, dates, degrees, skills, responsibilities, or achievements
that are not present in the candidate's data below. A position label may only
be lightly rephrased using the original role and documented duties. If the
candidate lacks something the job wants, do not fabricate it — reflect that
honestly in the reasons instead.

Optimize for earning an interview. Use confident, specific language, mirror the
vacancy's terminology where the candidate's evidence supports it, and foreground
transferable scope, ownership, outcomes, and stakeholder impact. Do not weaken
the CV with unnecessary caveats; keep unsupported requirements in the reasons.

Company/department names are immutable labels. Never prepend a parent
organization (including ADNOC or ADNOC Offshore), expand abbreviations,
translate them, or correct their spelling.

Return ONLY a valid JSON object. No markdown fences, no preamble.`;

export function buildPrompt(job: Pick<Job, "title" | "company" | "location" | "description">, profile: Profile) {
  const experienceBlock = profile.experience
    .map((e, i) => {
      const bulletsList = e.bullets
        .map((bullet, bulletIndex) => `    [bulletIndex=${bulletIndex}] ${bullet}`)
        .join("\n");
      return `[experienceIndex=${i}] ${e.company} — ${e.role}${e.dates ? ` (${e.dates})` : ""}\n${bulletsList}`;
    })
    .join("\n\n");

  const candidateContext = [
    `NAME: ${profile.name || "Candidate"}`,
    `CURRENT TITLE: ${profile.title || "n/a"}`,
    `LOCATION: ${profile.location || "n/a"}`,
    profile.summary ? `SUMMARY:\n${profile.summary}` : "",
    profile.skills.length ? `SKILLS:\n${profile.skills.join(", ")}` : "",
    profile.education.length ? `EDUCATION:\n${profile.education.join("\n")}` : "",
    profile.certifications.length ? `CERTIFICATIONS:\n${profile.certifications.join("\n")}` : "",
    profile.languages.length ? `LANGUAGES:\n${profile.languages.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return `A candidate is considering this job.

JOB TITLE: ${job.title}
COMPANY: ${job.company}
LOCATION: ${job.location || "n/a"}
JOB DESCRIPTION:
${job.description}

CANDIDATE'S FIXED CV DATA (do not alter employers/dates/skills/education; position labels may only be lightly and truthfully rephrased):
${candidateContext}

CANDIDATE'S EXPERIENCE, WITH BULLET INDICES (use these exact indices when choosing which bullets to rewrite):
${experienceBlock || "(no experience entries)"}

Do the following and return a single JSON object with exactly these keys:
{
  "score": <integer 0-100, how well the candidate fits this job>,
  "verdict": "<one short sentence, e.g. 'Strong fit — lead with SaaS + React'>",
  "reasons": ["<exactly 3 concise reasons behind the score, covering the strongest matches and most important gap>"],
  "tailoredSummary": "<one cohesive, confident and interview-focused professional profile of 1050-1100 characters INCLUDING spaces, targeting about 1075 characters; use 7-9 concise sentences tailored to THIS job; lead with the strongest direct and transferable evidence, use vacancy terminology where supported, and draw every claim from the candidate's real background; count the characters before returning and never return fewer than 1050 or more than 1100>",
  "experienceRewriteVersion": 2,
  "experienceRewrites": [
    {
      "experienceIndex": <copy the employer's 0-based position in the experience list above>,
      "company": "<copy one employer label exactly as listed above; never prepend, expand, translate, or correct it>",
      "role": "<optional concise, truthful rephrasing of that employer's existing position, replacing it entirely — never combine, append, or slash-join the original and new title together; use an empty string to keep the original role text unchanged>",
      "bulletsToRewrite": [<3-4 UNIQUE 0-based bullet indices, or every available index when the employer has fewer than 3 bullets; list the strongest job-relevant evidence first>],
      "rewrittenBullets": ["<confident, specific replacement for each selected bullet, using vacancy language where the source bullet supports it; same order and count as bulletsToRewrite>"],
      "remainingBulletOrder": [<every unselected 0-based bullet index exactly once, ordered from most to least relevant to this job>]
    }
  ],
  "coverLetter": "<a short, specific cover-letter BODY (100-140 words, 2-3 paragraphs) in a natural human voice, no clichés — do NOT include a greeting/salutation or a sign-off, those are added separately>",
  "auditTrail": [{"statement": "<one of at most 3 important claims made in the tailored summary or a rewritten bullet>", "source": "<the CV section/line/experience it is drawn from>"}]
}

The tailoredSummary length requirement is strict: 1050-1100 characters including spaces. Include exactly one experienceRewrites entry for EVERY employer, even when its role stays unchanged. For each employer with at least 3 bullets, rewrite 3-4 of its strongest existing bullets. If it has fewer than 3, rewrite every available bullet; use empty arrays when it has none. Base each replacement only on its selected source bullet, preserve every supported number and level of ownership, and never transfer evidence between employers. Put selected indices in descending job relevance, followed by every unselected index in descending relevance; for equal relevance retain original index order. Never create, omit, merge, split, or duplicate a bullet or claim. Copy every company/department label character-for-character and keep every date unchanged. Do not add, remove, or reorder employers, skills, or education — those are fixed and applied automatically. Keep every other field concise and return only the JSON object.`;
}

interface ExperienceRewrite {
  experienceIndex: number | null;
  company: string;
  role: string;
  bulletsToRewrite: number[];
  rewrittenBullets: string[];
  remainingBulletOrder: number[];
}

function normalizeSummaryText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function asSentence(value: unknown): string {
  const text = normalizeSummaryText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildVerifiedSummaryFacts(profile: Profile): string[] {
  const facts: string[] = [];

  for (const entry of profile.experience) {
    const position =
      entry.role && entry.company
        ? `${entry.role} at ${entry.company}`
        : entry.role || entry.company;
    if (position) {
      facts.push(
        asSentence(
          `Professional experience includes ${position}${entry.dates ? ` (${entry.dates})` : ""}`
        )
      );
    }
    facts.push(...entry.bullets.map(asSentence).filter(Boolean));
  }

  if (profile.skills.length) {
    facts.push(asSentence(`Core capabilities include ${profile.skills.join(", ")}`));
  }
  facts.push(...profile.education.map((line) => asSentence(`Education includes ${line}`)));
  facts.push(
    ...profile.certifications.map((line) => asSentence(`Professional certifications include ${line}`))
  );
  if (profile.languages.length) {
    facts.push(asSentence(`Languages include ${profile.languages.join(", ")}`));
  }

  // Keep the original profile summary as a final source of verified facts;
  // experience evidence is preferred first to reduce semantic repetition.
  if (profile.summary) facts.push(asSentence(profile.summary));
  return facts.filter(Boolean);
}

function trimSummaryToMaximum(text: string): string {
  const normalized = normalizeSummaryText(text);
  if (normalized.length <= SUMMARY_MAX_CHARS) return normalized;

  const limited = normalized.slice(0, SUMMARY_MAX_CHARS);
  for (let index = limited.length - 1; index >= SUMMARY_MIN_CHARS - 1; index -= 1) {
    if (/[.!?]/.test(limited[index]) && (index === limited.length - 1 || /\s/.test(limited[index + 1]))) {
      return limited.slice(0, index + 1).trim();
    }
  }

  const withoutFinalCharacter = limited.slice(0, SUMMARY_MAX_CHARS - 1);
  const lastSpace = withoutFinalCharacter.lastIndexOf(" ");
  const wordSafe =
    lastSpace >= SUMMARY_MIN_CHARS
      ? withoutFinalCharacter.slice(0, lastSpace)
      : withoutFinalCharacter;
  return `${wordSafe.replace(/[\s,;:–—-]+$/g, "")}.`;
}

function ensureTailoredSummaryLength(summary: unknown, profile: Profile): string {
  let combined = normalizeSummaryText(summary);

  for (const fact of buildVerifiedSummaryFacts(profile)) {
    if (combined.length >= SUMMARY_MIN_CHARS) break;
    if (combined.toLowerCase().includes(fact.toLowerCase())) continue;
    combined = normalizeSummaryText(`${combined} ${fact}`);
  }

  if (combined.length < SUMMARY_MIN_CHARS) {
    throw new LiveAnalysisError(
      "The profile does not contain enough verified information to create the required CV summary.",
      422
    );
  }

  const fitted = trimSummaryToMaximum(combined);
  if (fitted.length < SUMMARY_MIN_CHARS || fitted.length > SUMMARY_MAX_CHARS) {
    throw new LiveAnalysisError("Claude could not produce the required CV summary length.", 502);
  }
  return fitted;
}

// Occasionally the model ignores the "replace, don't combine" instruction
// and glues the original role onto the new one — sometimes verbatim
// ("Senior HSE Engineer / HSE Systems Lead"), sometimes with the original
// paraphrased too ("HSE Engineer / Safety Systems Lead", dropping
// "Senior"), in whatever order/separator it picks that call. A verbatim
// substring check misses the paraphrased case, so instead reject any
// rewrite containing a combining character at all — a genuine single job
// title essentially never needs "/", "(", or ")", and the prompt already
// tells the model never to combine titles that way.
function isCleanRoleRewrite(rewrittenRole: string): boolean {
  return !/[/()]/.test(rewrittenRole);
}

// Applies the model's chosen bullet rewrites onto a protected copy of the
// candidate's real experience. Employer order, company, dates and bullet count
// stay fixed; version 2 deliberately ranks bullets by vacancy relevance.
function applyExperienceRewrites(profile: Profile, raw: any): TailoredCVContent["experience"] {
  const rawRewrites = Array.isArray(raw?.experienceRewrites) ? raw.experienceRewrites : [];

  // Older saved/manual responses did not include an explicit schema version.
  // Keep accepting them without changing their original in-place behavior.
  if (Number(raw?.experienceRewriteVersion) !== 2) {
    const rewrites: ExperienceRewrite[] = rawRewrites
      .filter((rewrite: any) => typeof rewrite?.company === "string")
      .map((rewrite: any) => {
        const rawRole =
          typeof rewrite?.role === "string"
            ? rewrite.role.replace(/\s+/g, " ").trim().slice(0, 120)
            : "";
        return {
          experienceIndex: null,
          company: canonicalizeExperienceCompanyName(rewrite.company),
          role: rawRole && isCleanRoleRewrite(rawRole) ? rawRole : "",
          bulletsToRewrite: Array.isArray(rewrite?.bulletsToRewrite)
            ? rewrite.bulletsToRewrite.map(Number)
            : [],
          rewrittenBullets: Array.isArray(rewrite?.rewrittenBullets)
            ? rewrite.rewrittenBullets.map(String)
            : [],
          remainingBulletOrder: [],
        };
      });
    const usedRewriteIndexes = new Set<number>();

    return profile.experience.map((entry) => {
      const entryCompany = canonicalizeExperienceCompanyName(entry.company);
      const rewriteIndex = rewrites.findIndex(
        (rewrite, index) =>
          !usedRewriteIndexes.has(index) &&
          rewrite.company.trim().toLowerCase() === entryCompany.trim().toLowerCase()
      );
      const rewrite = rewriteIndex >= 0 ? rewrites[rewriteIndex] : undefined;
      if (rewriteIndex >= 0) usedRewriteIndexes.add(rewriteIndex);

      const bullets = [...entry.bullets];
      rewrite?.bulletsToRewrite.forEach((bulletIndex, index) => {
        const replacement = normalizeSummaryText(rewrite.rewrittenBullets[index]);
        if (
          Number.isInteger(bulletIndex) &&
          bulletIndex >= 0 &&
          bulletIndex < bullets.length &&
          replacement
        ) {
          bullets[bulletIndex] = replacement;
        }
      });
      return {
        company: entryCompany,
        role: rewrite?.role || entry.role,
        dates: entry.dates,
        bullets,
      };
    });
  }

  const invalidRewrite = (): never => {
    throw new LiveAnalysisError(
      "Claude did not return a complete per-employer experience rewrite. Please try again.",
      502
    );
  };

  if (rawRewrites.length !== profile.experience.length) invalidRewrite();
  const rewritesByIndex = new Map<number, ExperienceRewrite>();

  for (const rawRewrite of rawRewrites) {
    const experienceIndex = Number(rawRewrite?.experienceIndex);
    if (
      !Number.isInteger(experienceIndex) ||
      experienceIndex < 0 ||
      experienceIndex >= profile.experience.length ||
      rewritesByIndex.has(experienceIndex)
    ) {
      invalidRewrite();
    }

    const entry = profile.experience[experienceIndex];
    const entryCompany = canonicalizeExperienceCompanyName(entry.company);
    const rewriteCompany = canonicalizeExperienceCompanyName(String(rawRewrite?.company || ""));
    if (rewriteCompany.trim().toLowerCase() !== entryCompany.trim().toLowerCase()) invalidRewrite();

    const bulletsToRewrite: number[] = Array.isArray(rawRewrite?.bulletsToRewrite)
      ? rawRewrite.bulletsToRewrite.map(Number)
      : [];
    const rewrittenBullets: string[] = Array.isArray(rawRewrite?.rewrittenBullets)
      ? rawRewrite.rewrittenBullets.map(normalizeSummaryText)
      : [];
    const remainingBulletOrder: number[] = Array.isArray(rawRewrite?.remainingBulletOrder)
      ? rawRewrite.remainingBulletOrder.map(Number)
      : [];
    const bulletCount = entry.bullets.length;
    const minimumRewrites = Math.min(3, bulletCount);
    const maximumRewrites = Math.min(4, bulletCount);

    if (
      bulletsToRewrite.length < minimumRewrites ||
      bulletsToRewrite.length > maximumRewrites ||
      rewrittenBullets.length !== bulletsToRewrite.length ||
      rewrittenBullets.some((bullet) => !bullet)
    ) {
      invalidRewrite();
    }

    const selectedIndexes = new Set<number>();
    for (const bulletIndex of bulletsToRewrite) {
      if (
        !Number.isInteger(bulletIndex) ||
        bulletIndex < 0 ||
        bulletIndex >= bulletCount ||
        selectedIndexes.has(bulletIndex)
      ) {
        invalidRewrite();
      }
      selectedIndexes.add(bulletIndex);
    }

    if (remainingBulletOrder.length !== bulletCount - selectedIndexes.size) invalidRewrite();
    const remainingIndexes = new Set<number>();
    for (const bulletIndex of remainingBulletOrder) {
      if (
        !Number.isInteger(bulletIndex) ||
        bulletIndex < 0 ||
        bulletIndex >= bulletCount ||
        selectedIndexes.has(bulletIndex) ||
        remainingIndexes.has(bulletIndex)
      ) {
        invalidRewrite();
      }
      remainingIndexes.add(bulletIndex);
    }
    if (selectedIndexes.size + remainingIndexes.size !== bulletCount) invalidRewrite();

    const rawRole =
      typeof rawRewrite?.role === "string"
        ? rawRewrite.role.replace(/\s+/g, " ").trim().slice(0, 120)
        : "";
    rewritesByIndex.set(experienceIndex, {
      experienceIndex,
      company: entryCompany,
      role: rawRole && isCleanRoleRewrite(rawRole) ? rawRole : "",
      bulletsToRewrite,
      rewrittenBullets,
      remainingBulletOrder,
    });
  }

  return profile.experience.map((entry, experienceIndex) => {
    const rewrite = rewritesByIndex.get(experienceIndex) ?? invalidRewrite();

    const replacements = new Map<number, string>();
    rewrite.bulletsToRewrite.forEach((bulletIndex, index) => {
      replacements.set(bulletIndex, rewrite.rewrittenBullets[index]);
    });
    const finalOrder = [...rewrite.bulletsToRewrite, ...rewrite.remainingBulletOrder];

    return {
      company: canonicalizeExperienceCompanyName(entry.company),
      role: rewrite.role || entry.role,
      dates: entry.dates,
      bullets: finalOrder.map(
        (bulletIndex) => replacements.get(bulletIndex) || entry.bullets[bulletIndex]
      ),
    };
  });
}

export function toAnalysis(parsed: any, profile: Profile): Analysis {
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  const tier = getMatchTier(score);
  const tailoredCV: TailoredCVContent = {
    summary: ensureTailoredSummaryLength(parsed.tailoredSummary || profile.summary || "", profile),
    skills: profile.skills,
    experience: applyExperienceRewrites(profile, parsed),
    education: profile.education,
  };
  return {
    score,
    tier: tier.key,
    tierLabel: tier.label,
    verdict: String(parsed.verdict || ""),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
    tailoredCV,
    coverLetter: String(parsed.coverLetter || ""),
    auditTrail: Array.isArray(parsed.auditTrail)
      ? parsed.auditTrail.map((e: any) => ({
          statement: String(e?.statement || ""),
          source: String(e?.source || ""),
        }))
      : [],
  };
}

export function parseModelResponse(text: string) {
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const json =
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;
  const parsed = JSON.parse(json);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Number.isFinite(Number(parsed.score)) ||
    typeof parsed.tailoredSummary !== "string"
  ) {
    throw new Error("Claude returned an incomplete analysis.");
  }
  return parsed;
}

export async function analyzeJobForCandidate(
  job: Pick<Job, "title" | "company" | "location" | "description" | "id">,
  profile: Profile
): Promise<Analysis> {
  const candidateProfile = sanitizeProfile(profile);
  const key = process.env.ANTHROPIC_API_KEY;
  const masterCV = buildMasterCVMarkdown(candidateProfile);

  if (process.env.DEMO_MODE === "true" || !key) {
    const demo = buildDemoAnalysis(job as Job, masterCV, "Simulated preview — Claude was not called.");
    return {
      ...demo,
      tailoredCV: {
        ...demo.tailoredCV,
        summary: ensureTailoredSummaryLength(demo.tailoredCV.summary, candidateProfile),
      },
    };
  }

  try {
    // Bound the call well under the route's maxDuration (60s) so an
    // unbounded provider request cannot leave the client waiting forever.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);
    let r: Response | null = null;
    try {
      // 3 attempts, not 2 — a rate-limit/5xx response comes back fast (not
      // after a full generation), so the extra attempt costs little time
      // but meaningfully improves resilience against transient blips.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: MODEL,
              max_tokens: 4500,
              ...MODEL_PERFORMANCE_OPTIONS,
              system: SYSTEM,
              messages: [{ role: "user", content: buildPrompt(job, candidateProfile) }],
            }),
            signal: controller.signal,
          });
        } catch (error: any) {
          if (attempt < 2 && error?.name !== "AbortError") {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          throw error;
        }

        if (r.ok || attempt === 2 || !TRANSIENT_PROVIDER_STATUSES.has(r.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!r || !r.ok) {
      const providerStatus = r?.status || 502;
      const providerDetail = r ? (await r.text()).slice(0, 500) : "No response";
      console.error("Claude tailoring request failed", providerStatus, providerDetail);

      // A billing/credit failure isn't transient — "try again" is actively
      // misleading here, since retrying can't fix it. Surface the real cause
      // so whoever's watching knows to add credit rather than keep clicking.
      if (providerStatus === 400 && /credit balance is too low/i.test(providerDetail)) {
        throw new LiveAnalysisError(
          "The AI service has run out of credit. Add credit in the Anthropic Console (Plans & Billing), then try again.",
          402
        );
      }

      throw new LiveAnalysisError("Live tailoring is temporarily unavailable. Please try again.", 502);
    }

    const data = await r.json();
    if (data.stop_reason === "max_tokens") {
      throw new LiveAnalysisError("Claude could not finish the CV response. Please try again.", 502);
    }
    const text: string = (data.content || [])
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    const parsed = parseModelResponse(text);
    return toAnalysis(parsed, candidateProfile);
  } catch (error: any) {
    if (error instanceof LiveAnalysisError) throw error;
    if (error?.name === "AbortError") {
      throw new LiveAnalysisError("Live tailoring timed out. Please try again.", 504);
    }
    console.error("Failed to parse or build live tailoring response", error);
    throw new LiveAnalysisError("Claude returned an invalid CV response. Please try again.", 502);
  }
}
