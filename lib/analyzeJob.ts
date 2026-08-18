import { Analysis, Job, Profile, TailoredCVContent } from "./types";
import { buildDemoAnalysis } from "./demoAnalysis";
import { buildMasterCVMarkdown } from "./masterCV";
import { getMatchTier } from "./matchTier";
import { canonicalizeExperienceCompanyName, sanitizeProfile } from "./profile";
import {
  formatRoleResearchBrief,
  loadRoleResearchBrief,
  RoleResearchBrief,
  RoleResearchSource,
  saveRoleResearchBrief,
} from "./roleResearch.server";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// 429 (rate-limited) is retried too, not just 5xx/529 — a rate-limit
// response is exactly the kind of transient condition retrying resolves,
// and previously it went straight to failure with no retry at all.
const TRANSIENT_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 529]);
const SUMMARY_MIN_CHARS = 1050;
const SUMMARY_MAX_CHARS = 1100;
const EXPERIENCE_REWRITE_VERSION = 3;
const PROMPT_SCHEMA_REVISION = "cv-tailoring-v3.1";
const MIN_FULL_JOB_DESCRIPTION_CHARS = 240;
const MAX_MODEL_TOKENS = 6000;
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 1,
  user_location: {
    type: "approximate",
    city: "Abu Dhabi",
    region: "Abu Dhabi",
    country: "AE",
    timezone: "Asia/Dubai",
  },
} as const;
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

export class TailoringQualityError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "TailoringQualityError";
    this.issues = issues;
  }
}

class WebResearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebResearchUnavailableError";
  }
}

class RetryableClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableClaudeError";
  }
}

export const SYSTEM = `You are an expert CV strategist and evidence-grounded recruiter. Analyze one complete vacancy against one candidate's fixed CV.

Your objective is to make the CV visibly and specifically relevant to this vacancy while remaining defensible in an interview. Rewrite the full profile and create concise tailored highlights from the candidate's real evidence. You may combine multiple bullets only when they belong to the SAME employer. Never transfer evidence between employers.

Never invent or upgrade an employer, date, metric, tool, qualification, certification, responsibility, seniority, team size, budget, client, industry, or outcome. Never imply ownership when the evidence only shows participation. Requirements without evidence belong in the fit reasons, not the CV. Employer/department labels, role labels, dates, education, and skill values are immutable; skills may only be reordered.

Candidate-facing text means tailoredSummary, experienceRewrites[].tailoredHighlights[].text, and coverLetter. Candidate-facing text may use a vacancy acronym, standard, tool, industry term, or responsibility only when it is supported by the candidate's fixed evidence. The cover letter may name the exact target role and employer only as neutral application context, never as candidate experience. Unsupported vacancy/research terminology belongs only in rankedRequirements, roleResearch, verdict, reasons, or gaps. On a corrective pass, remove the whole unsupported claim; never hide it by spelling out an acronym or replacing it with a synonym. This applies even when disclosing a gap: never write a sentence like "does not have experience with X" or "lacks X" in candidate-facing text if X is an unsupported tool, standard, or qualification — omit it by name entirely and put it in reasons/gaps instead. Naming an unsupported term to deny it still counts as adding it.

Treat the vacancy description as the primary source. General role research is secondary context only and must never become candidate evidence. Return ONLY one valid JSON object, with no markdown fence or commentary.`;

interface BuildPromptOptions {
  cachedRoleResearch?: RoleResearchBrief | null;
  requestWebResearch?: boolean;
  correctionIssues?: string[];
}

export function buildPrompt(
  job: Pick<Job, "title" | "company" | "location" | "description">,
  profile: Profile,
  options: BuildPromptOptions = {}
) {
  const experienceBlock = profile.experience
    .map((entry, experienceIndex) => {
      const bullets = entry.bullets
        .map((bullet, bulletIndex) => `    [bulletIndex=${bulletIndex}] ${bullet}`)
        .join("\n");
      return `[experienceIndex=${experienceIndex}] COMPANY: ${entry.company}\nROLE: ${entry.role}\nDATES: ${entry.dates || "n/a"}\n${bullets || "    (no bullets)"}`;
    })
    .join("\n\n");
  const skillBlock = profile.skills
    .map((skill, skillIndex) => `[skillIndex=${skillIndex}] ${skill}`)
    .join("\n");
  const researchInstructions = options.cachedRoleResearch
    ? `A cached role-research brief is supplied below. Use it only to interpret common role expectations; the vacancy remains primary and it is NOT evidence about the candidate.\n${formatRoleResearchBrief(options.cachedRoleResearch)}`
    : options.requestWebResearch
      ? `Use the web-search tool exactly ONCE to research current, reputable expectations for this normalized role in the UAE or its functional domain. Prefer official/professional sources. Put the concise result in roleResearch. If search is unavailable or weak, continue from the full vacancy description without guessing.`
      : `No external role research is supplied. Derive role expectations from the COMPLETE vacancy description and continue normally; do not request or depend on tools.`;
  const correction = options.correctionIssues?.length
    ? `\nCORRECTIVE PASS: The previous response failed these checks. Fix every item without changing protected facts:\n${options.correctionIssues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}\n`
    : "";

  return `PROMPT_SCHEMA_REVISION: ${PROMPT_SCHEMA_REVISION}

TARGET VACANCY (analyze the entire description, not only keywords)
TITLE: ${job.title}
COMPANY: ${job.company}
LOCATION: ${job.location || "n/a"}
FULL JOB DESCRIPTION:
${job.description}

ROLE-EXPECTATION CONTEXT
${researchInstructions}

CANDIDATE PROFILE (fixed evidence)
NAME: ${profile.name || "Candidate"}
CURRENT TITLE: ${profile.title || "n/a"}
LOCATION: ${profile.location || "n/a"}
ORIGINAL PROFILE:
${profile.summary || "n/a"}

FIXED SKILLS (return every index exactly once in skillsOrder; reorder only):
${skillBlock || "(none)"}

FIXED EDUCATION:
${profile.education.join("\n") || "(none)"}

FIXED CERTIFICATIONS:
${profile.certifications.join("\n") || "(none)"}

FIXED LANGUAGES:
${profile.languages.join("\n") || "(none)"}

EXPERIENCE EVIDENCE WITH PROTECTED INDICES:
${experienceBlock || "(none)"}
${correction}
Return this exact schema:
{
  "promptSchemaRevision": "${PROMPT_SCHEMA_REVISION}",
  "score": <integer 0-100>,
  "verdict": "<one concise fit sentence>",
  "reasons": ["<exactly 3 concise evidence/gap reasons>"],
  "roleResearch": {
    "normalizedRole": "<role family, not employer-specific>",
    "marketContext": "<brief current role context or empty string>",
    "expectations": ["<3-8 concise common expectations>"],
    "sources": [{"title": "<source title>", "url": "<http(s) URL>"}]
  },
  "rankedRequirements": [
    {
      "id": "R1",
      "priority": 1,
      "importance": "mandatory",
      "requirement": "<specific responsibility, skill, scope, or qualification>",
      "source": "job_description",
      "evidence": [{"experienceIndex": 0, "bulletIndices": [0, 2]}]
    }
  ],
  "tailoredSummary": "<a COMPLETELY REWRITTEN, cohesive vacancy-specific profile of 1050-1100 characters INCLUDING spaces; 7-10 concise sentences; visibly different from the original; lead with direct evidence for the top requirements, then supported transferable evidence and realistic scope; do not include unsupported gaps or generic filler>",
  "skillsOrder": [<every fixed skillIndex exactly once, most relevant first>],
  "experienceRewriteVersion": 3,
  "experienceRewrites": [
    {
      "experienceIndex": 0,
      "company": "<copy exact company label>",
      "supported": true,
      "tailoredHighlights": [
        {
          "text": "<strong vacancy-specific achievement/responsibility synthesized only from the selected bullets for this employer>",
          "sourceBulletIndices": [0, 2],
          "requirementIds": ["R1"]
        }
      ],
      "remainingBulletOrder": [1, 3]
    }
  ],
  "coverLetter": "<specific 100-140 word body, 2-3 paragraphs, no greeting/sign-off>",
  "auditTrail": []
}

Rules for rankedRequirements:
- Return 6-10 requirements ranked by importance after reading the COMPLETE job description. Every item must use source "job_description"; role research is context only and stays in roleResearch.
- Set importance to "mandatory", "preferred", or "context" based only on how the vacancy itself presents the requirement. Rank mandatory requirements first.
- Keep each requirement atomic. Do not combine a supported duty with a separate unsupported duty, tool, qualification, or scope in one requirement.
- Evidence must point only to bullet indices that genuinely support the requirement. Use an empty evidence array for unsupported requirements; never manufacture a link.

Rules for every employer:
- Return exactly one experienceRewrites entry per employer, in input order, copying company exactly. Never rewrite role/date/company.
- If this employer has enough evidence for the vacancy, set supported=true and create 2 strong tailoredHighlights FIRST. Add a third only when it supports a distinct atomic requirement and is substantially rewritten rather than restating the source. Each highlight may synthesize one or more source bullets, but all indices must belong to this SAME employer.
- EVERY highlight, not just the third, must be a substantial rewrite of its source bullet(s) — restructure sentence order and phrasing, lead with a different word, combine or split clauses differently. Swapping punctuation (dashes to commas), reordering only two words, or changing a single word while keeping the same sentence structure is NOT a rewrite and will be rejected. If you cannot substantially restructure a bullet while keeping every fact exact, select different source bullets instead.
- Select the strongest, most relevant evidence. Do not reuse a source bullet in two highlights. Preserve every number, named tool, qualification, and ownership level exactly; never add one from the vacancy or research.
- Preserve the evidence's participation level for each activity: participated, supported, contributed, or collaborated must never become executed, conducted, led, managed, directed, or owned.
- Every selected source bullet is replaced by its highlight and therefore MUST NOT appear in remainingBulletOrder. remainingBulletOrder must contain every unselected original index exactly once, ranked by vacancy relevance. This prevents duplication and CV growth.
- If fewer than two defensible highlights exist, set supported=false, return no highlights, and put every original bullet index once in remainingBulletOrder, still ranked by relevance.
- Give each highlight only 1-2 requirementIds. Each id must identify an atomic ranked requirement directly supported by that highlight's selected source bullets. Do not tag a requirement merely because it is generally related or transferable.

The final CV must look specifically written for this vacancy, but every claim must remain traceable to the fixed candidate evidence. Count tailoredSummary characters before returning. Return JSON only.`;
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

function buildVerifiedSummaryFacts(profile: Profile, preferredFacts: string[] = []): string[] {
  const facts: string[] = preferredFacts.map(asSentence).filter(Boolean);

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

function ensureTailoredSummaryLength(
  summary: unknown,
  profile: Profile,
  preferredFacts: string[] = []
): string {
  let combined = normalizeSummaryText(summary);

  for (const fact of buildVerifiedSummaryFacts(profile, preferredFacts)) {
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
    throw new TailoringQualityError([
      "Rewrite the tailored profile to 1050-1100 characters including spaces.",
    ]);
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

interface RequirementEvidence {
  experienceIndex: number;
  bulletIndices: number[];
}

interface RankedRequirement {
  id: string;
  priority: number;
  importance: "mandatory" | "preferred" | "context";
  requirement: string;
  source: "job_description";
  evidence: RequirementEvidence[];
}

interface TailoredHighlight {
  text: string;
  sourceBulletIndices: number[];
  requirementIds: string[];
}

interface ExperienceRewriteV3 {
  experienceIndex: number;
  company: string;
  supported: boolean;
  tailoredHighlights: TailoredHighlight[];
  remainingBulletOrder: number[];
}

function parseRankedRequirements(raw: any, profile: Profile): RankedRequirement[] {
  const items = Array.isArray(raw?.rankedRequirements) ? raw.rankedRequirements : [];
  const invalid = (issue: string): never => {
    throw new TailoringQualityError([issue]);
  };
  if (Number(raw?.experienceRewriteVersion) === EXPERIENCE_REWRITE_VERSION) {
    if (items.length < 6 || items.length > 10) {
      invalid("Return 6-10 ranked requirements from the complete job description.");
    }
  }

  const ids = new Set<string>();
  const priorities = new Set<number>();
  const requirementTexts = new Set<string>();
  const parsed: RankedRequirement[] = items.map((item: any, itemIndex: number) => {
    const id = normalizeSummaryText(item?.id).toUpperCase();
    const priority = Number(item?.priority);
    const importance = item?.importance;
    const requirement = normalizeSummaryText(item?.requirement);
    const requirementKey = [...comparableTokens(requirement)].sort().join(" ");
    const source = item?.source;
    // Each condition gets its own specific message (instead of one bundled
    // check) so a corrective pass is told exactly what's wrong with this
    // requirement rather than having to guess which of six possible
    // problems it has.
    const label = `Ranked requirement ${itemIndex + 1}${id ? ` (${id})` : ""}`;
    if (!/^R\d+$/.test(id)) {
      invalid(`${label} has an invalid id "${item?.id ?? ""}" — id must match the pattern R<number>, e.g. "R5".`);
    }
    if (ids.has(id)) {
      invalid(`${label} reuses id "${id}", which is already used by an earlier requirement — every id must be unique.`);
    }
    if (!requirement) {
      invalid(`${label} is missing its "requirement" text.`);
    }
    if (!requirementKey) {
      invalid(`${label} ("${requirement}") has no meaningful, comparable content — write a more specific requirement.`);
    }
    if (requirementTexts.has(requirementKey)) {
      invalid(`${label} ("${requirement}") duplicates another requirement's meaning — merge them into one, or rewrite this one to be distinct.`);
    }
    if (!Number.isInteger(priority)) {
      invalid(`${label} has an invalid "priority" value "${item?.priority ?? ""}" — priority must be an integer.`);
    }
    if (priorities.has(priority)) {
      invalid(`${label} reuses priority ${priority}, which is already used by an earlier requirement — every priority must be unique.`);
    }
    if (!["mandatory", "preferred", "context"].includes(importance)) {
      invalid(`${label} has an invalid "importance" value "${importance ?? ""}" — importance must be exactly "mandatory", "preferred", or "context".`);
    }
    if (source !== "job_description") {
      invalid(`${label} has an invalid "source" value "${source ?? ""}" — source must be exactly "job_description".`);
    }
    ids.add(id);
    priorities.add(priority);
    requirementTexts.add(requirementKey);

    const evidence: RequirementEvidence[] = (Array.isArray(item?.evidence) ? item.evidence : []).map(
      (reference: any) => {
        const experienceIndex = Number(reference?.experienceIndex);
        const bulletIndices = Array.isArray(reference?.bulletIndices)
          ? reference.bulletIndices.map(Number)
          : [];
        const entry = profile.experience[experienceIndex];
        if (
          !Number.isInteger(experienceIndex) ||
          !entry ||
          bulletIndices.length === 0 ||
          new Set(bulletIndices).size !== bulletIndices.length ||
          bulletIndices.some(
            (bulletIndex: number) =>
              !Number.isInteger(bulletIndex) || bulletIndex < 0 || bulletIndex >= entry.bullets.length
          )
        ) {
          invalid(`Requirement ${id} has an invalid experience evidence reference.`);
        }
        return { experienceIndex, bulletIndices };
      }
    );
    return { id, priority, importance, requirement, source, evidence };
  });
  const sorted = parsed.sort((a, b) => a.priority - b.priority);
  const importanceRank: Record<RankedRequirement["importance"], number> = {
    mandatory: 0,
    preferred: 1,
    context: 2,
  };
  sorted.forEach((requirement, index) => {
    if (requirement.priority !== index + 1) {
      invalid("Ranked requirement priorities must be consecutive from 1 through N.");
    }
    if (
      index > 0 &&
      importanceRank[requirement.importance] <
        importanceRank[sorted[index - 1].importance]
    ) {
      invalid("Mandatory requirements must precede preferred and context requirements.");
    }
  });
  return sorted;
}

const SENSITIVE_FACT_TERMS = [
  "SQL",
  "Python",
  "Excel",
  "SAP",
  "Oracle",
  "Jira",
  "Power BI",
  "Tableau",
  "Salesforce",
  "ERP",
  "CRM",
  "AWS",
  "Azure",
  "GCP",
  "PMP",
  "PRINCE2",
  "SAFe",
  "ISO",
  "FEED",
  "EPC",
];

function normalizedFactToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%]+/g, "");
}

const BENIGN_NARRATIVE_ACRONYMS = new Set(["CV", "JD"]);

function extractAcronyms(value: string): Set<string> {
  return new Set(
    (value.match(/\b[A-Z][A-Z0-9]{1,9}(?:s|es)?\b/g) || [])
      // CV prose commonly pluralizes acronyms (KPIs, SLAs, APIs, NCRs).
      .map((token) => token.replace(/(?:es|s)$/, "").toUpperCase())
      .filter((token) => !/^\d+$/.test(token))
  );
}

function unsupportedAcronyms(
  value: string,
  sourceText: string,
  allowedContext = ""
): string[] {
  const supported = extractAcronyms(`${sourceText} ${allowedContext}`);
  return [...extractAcronyms(value)].filter(
    (token) => !BENIGN_NARRATIVE_ACRONYMS.has(token) && !supported.has(token)
  );
}

// A vacancy often defines its own shorthand for the employer, e.g. "Abu
// Dhabi International Airport (ADIA)" when job.company is "Abu Dhabi
// Airports" — the cover letter is explicitly allowed to name the target
// employer as neutral context, and that should cover the employer's own
// acronym too, not just the literal company string. Deliberately
// conservative: only trusts a parenthetical acronym when its letters are
// exactly the preceding phrase's initials AND that phrase shares real
// wording with the company name — so unrelated JD acronyms defined nearby
// (e.g. "Air Operations Committee (AOC)" in the same posting) are never
// swept in just for sharing a generic word like "Air"/"Airport".
function extractEmployerAcronyms(description: string, company: string): string[] {
  const companyTokens = comparableTokens(company);
  if (!companyTokens.size) return [];
  const found: string[] = [];
  const pattern = /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,5})\s*\(([A-Z]{2,6})\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(description))) {
    const [, phrase, acronym] = match;
    const initials = phrase
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
    if (initials !== acronym) continue;
    const phraseTokens = comparableTokens(phrase);
    if ([...phraseTokens].some((token) => companyTokens.has(token))) {
      found.push(acronym);
    }
  }
  return found;
}

function removeUnsupportedAcronymSentences(
  value: unknown,
  sourceText: string,
  allowedContext = ""
): string {
  const text = normalizeSummaryText(value);
  if (!text) return "";
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text];
  return normalizeSummaryText(
    sentences
      .filter((sentence) => unsupportedAcronyms(sentence, sourceText, allowedContext).length === 0)
      .join(" ")
  );
}

function completeProfileEvidence(profile: Profile): string {
  return [
    profile.name,
    profile.title,
    profile.location,
    profile.summary,
    ...profile.skills,
    ...profile.education,
    ...profile.certifications,
    ...profile.languages,
    ...profile.experience.flatMap((entry) => [
      entry.company,
      entry.role,
      entry.dates,
      ...entry.bullets,
    ]),
  ].join(" ");
}

// Quotes the exact sentence containing `needle` back into an issue message,
// so a corrective pass can locate and delete the precise offending text
// instead of having to search a whole field for a category of problem.
// Falls back to the full text when sentence-splitting can't isolate it.
function quoteOffendingSentence(text: string, needle: string | RegExp): string {
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text];
  const pattern = typeof needle === "string" ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : needle;
  const sentence = sentences.find((candidate) => pattern.test(candidate));
  return (sentence || text).trim();
}

function evidenceGuardIssues(
  highlight: string,
  sourceText: string,
  originalRole: string,
  label: string,
  allowedContext = ""
): string[] {
  const issues: string[] = [];
  const sourceLower = sourceText.toLowerCase();
  const evidenceText = `${sourceText} ${originalRole}`;
  const evidenceScope = evidenceText.toLowerCase();
  const sourceNumbers = new Set(
    (sourceText.match(/\b\d[\d,.]*(?:%|\+)?\b/g) || []).map(normalizedFactToken)
  );
  const addedNumbers = (highlight.match(/\b\d[\d,.]*(?:%|\+)?\b/g) || []).filter(
    (token) => !sourceNumbers.has(normalizedFactToken(token))
  );
  if (addedNumbers.length) {
    const quoted = quoteOffendingSentence(highlight, addedNumbers[0]);
    issues.push(
      `${label} adds unsupported numeric evidence (${addedNumbers.join(", ")}) in: "${quoted}" — delete this whole sentence, do not just remove the number.`
    );
  }

  for (const term of SENSITIVE_FACT_TERMS) {
    const termPattern = new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (termPattern.test(highlight) && !termPattern.test(sourceText)) {
      const quoted = quoteOffendingSentence(highlight, termPattern);
      issues.push(
        `${label} adds unsupported tool, framework, or qualification ${term} in: "${quoted}" — delete this whole sentence entirely, even if it only names ${term} to disclaim it; unsupported terms cannot appear in candidate-facing text at all.`
      );
    }
  }

  // "direct" is deliberately excluded in its bare form (unlike the other
  // verbs here) — in natural resume writing it's overwhelmingly an adjective
  // ("direct collaboration", "direct involvement", "direct contact"), not a
  // management claim, and the source evidence often has "directly"
  // (adverb) for the same fact — which the word-boundary \b never matches
  // against bare "direct" anyway, so a harmless directly->direct rewrite
  // was tripping this as a false "ownership upgrade". directs/directed/
  // directing are unambiguous verb forms and still count.
  const ownership =
    /\b(?:lead|leads|leading|led|manage|manages|managed|managing|own|owns|owned|owning|directs|directed|directing|supervise|supervises|supervised|supervising|oversee|oversees|overseeing|oversaw|head|heads|headed|heading|accountable for)\b/i;
  if (ownership.test(highlight) && !ownership.test(evidenceScope)) {
    issues.push(`${label} upgrades ownership beyond its same-employer evidence.`);
  }
  const auditOwnership =
    /\b(?:execut(?:e|es|ed|ing)|conduct(?:s|ed|ing)?|perform(?:s|ed|ing)?|lead(?:s|ing)?|led|manage(?:s|d|ment|ing)?|direct(?:s|ed|ing))\b[^.]{0,60}\baudits?\b/i;
  if (auditOwnership.test(highlight) && !auditOwnership.test(evidenceText)) {
    issues.push(`${label} upgrades participation in audits into audit ownership.`);
  }
  const qualification = /\b(certified|certification|degree|bachelor(?:'s)?|master(?:'s)?|chartered)\b/i;
  if (qualification.test(highlight) && !qualification.test(sourceLower)) {
    issues.push(`${label} adds an unsupported qualification.`);
  }

  // Require a meaningful share of each rewritten claim to remain directly
  // anchored to its selected same-employer evidence. This is deliberately a
  // directed overlap (claim -> evidence), not similarity: the model can still
  // rewrite strongly, but it cannot replace the source with unrelated JD text.
  const claimTokens = comparableTokens(highlight);
  if (claimTokens.size >= 6) {
    const evidenceTokens = comparableTokens(evidenceText);
    const supportedTokenCount = [...claimTokens].filter((token) => evidenceTokens.has(token)).length;
    if (supportedTokenCount / claimTokens.size < 0.28) {
      issues.push(`${label} is not sufficiently grounded in its selected candidate evidence.`);
    }
  }

  // Catch arbitrary acronyms that a fixed allow-list cannot anticipate. Target
  // company/title acronyms are allowed only where explicitly passed as context;
  // tools, frameworks and qualifications still need to exist in CV evidence.
  const addedAcronyms = unsupportedAcronyms(highlight, evidenceText, allowedContext);
  if (addedAcronyms.length) {
    issues.push(
      `${label} adds unsupported acronym${addedAcronyms.length === 1 ? "" : "s"} (${addedAcronyms.join(", ")}).`
    );
  }
  return issues;
}

function applyExperienceHighlightsV3(
  profile: Profile,
  raw: any
): TailoredCVContent["experience"] {
  const requirements = parseRankedRequirements(raw, profile);
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const rawRewrites = Array.isArray(raw?.experienceRewrites) ? raw.experienceRewrites : [];
  const qualityIssues: string[] = [];
  if (rawRewrites.length !== profile.experience.length) {
    throw new TailoringQualityError([
      "Return exactly one version-3 experience rewrite for every employer.",
    ]);
  }

  const rewritesByIndex = new Map<number, ExperienceRewriteV3>();
  for (const rawRewrite of rawRewrites) {
    const experienceIndex = Number(rawRewrite?.experienceIndex);
    const entry = profile.experience[experienceIndex];
    if (!Number.isInteger(experienceIndex) || !entry || rewritesByIndex.has(experienceIndex)) {
      qualityIssues.push("Experience rewrites contain a missing, duplicate, or invalid employer index.");
      continue;
    }
    const expectedCompany = canonicalizeExperienceCompanyName(entry.company);
    const returnedCompany = normalizeSummaryText(rawRewrite?.company);
    if (expectedCompany !== returnedCompany) {
      qualityIssues.push(`Employer ${experienceIndex + 1} must copy its company label exactly.`);
    }

    const supported = rawRewrite?.supported === true;
    const rawHighlights = Array.isArray(rawRewrite?.tailoredHighlights)
      ? rawRewrite.tailoredHighlights
      : [];
    if ((supported && (rawHighlights.length < 2 || rawHighlights.length > 3)) || (!supported && rawHighlights.length)) {
      qualityIssues.push(
        `${expectedCompany}: supported employers need 2-3 highlights; unsupported employers need none.`
      );
    }

    const seenSourceIndexes = new Set<number>();
    const usedSourceIndexes = new Set<number>();
    const restoredSourceIndexes: number[] = [];
    const highlights: TailoredHighlight[] = [];
    for (let highlightIndex = 0; highlightIndex < rawHighlights.length; highlightIndex += 1) {
      const rawHighlight = rawHighlights[highlightIndex];
      const text = normalizeSummaryText(rawHighlight?.text).slice(0, 420);
      const sourceBulletIndices = Array.isArray(rawHighlight?.sourceBulletIndices)
        ? rawHighlight.sourceBulletIndices.map(Number)
        : [];
      const requirementIds = Array.isArray(rawHighlight?.requirementIds)
        ? rawHighlight.requirementIds.map((id: unknown) => normalizeSummaryText(id).toUpperCase())
        : [];
      const label = `${expectedCompany} highlight ${highlightIndex + 1}`;
      if (!text || sourceBulletIndices.length === 0 || requirementIds.length === 0) {
        qualityIssues.push(`${label} needs text, source bullets, and requirement ids.`);
        continue;
      }
      if (
        new Set(sourceBulletIndices).size !== sourceBulletIndices.length ||
        sourceBulletIndices.some(
          (bulletIndex: number) =>
            !Number.isInteger(bulletIndex) ||
            bulletIndex < 0 ||
            bulletIndex >= entry.bullets.length ||
            seenSourceIndexes.has(bulletIndex)
        )
      ) {
        qualityIssues.push(`${label} must use valid, non-reused bullets from the same employer.`);
        continue;
      }
      sourceBulletIndices.forEach((index: number) => seenSourceIndexes.add(index));
      const sourceText = sourceBulletIndices
        .map((index: number) => entry.bullets[index])
        .join(" ");
      if (tokenJaccard(text, sourceText) > 0.9) {
        // A near-copy is not a tailored highlight. Preserve its original
        // source bullets in the remaining list instead of rejecting an
        // otherwise usable manual response or presenting unchanged text as
        // newly tailored content. Surfaced explicitly (not just a silent
        // drop) so a corrective pass knows exactly which highlight and text
        // needs a substantive rewrite, not just punctuation changes.
        qualityIssues.push(
          `${label} ("${text}") is a near-verbatim copy of its source bullet ("${sourceText}") — substantially rephrase the sentence structure and wording while preserving every fact exactly.`
        );
        restoredSourceIndexes.push(...sourceBulletIndices);
        continue;
      }
      if (requirementIds.some((id: string) => !requirementById.has(id))) {
        qualityIssues.push(`${label} references an unknown ranked requirement.`);
      }
      const validatedRequirementIds: string[] = [];
      const failedRequirements: string[] = [];
      for (const requirementId of requirementIds) {
        const requirement = requirementById.get(requirementId);
        if (!requirement) continue;
        const tracesDeclaredEvidence = requirement.evidence
          .filter((reference) => reference.experienceIndex === experienceIndex)
          .some((reference) =>
            sourceBulletIndices.some((bulletIndex: number) =>
              reference.bulletIndices.includes(bulletIndex)
            )
          );
        if (
          tracesDeclaredEvidence &&
          requirementLinkIsSupported(requirement.requirement, text, sourceText, entry.role)
        ) {
          validatedRequirementIds.push(requirementId);
        } else {
          failedRequirements.push(`${requirementId} ("${requirement.requirement}")`);
        }
      }
      if (validatedRequirementIds.length === 0) {
        qualityIssues.push(
          `${label} ("${text}") must visibly connect its selected evidence to at least one atomic job requirement — it is tagged to ${failedRequirements.join(", ") || "no valid requirement"} but shares no concrete wording with ${failedRequirements.length === 1 ? "it" : "any of them"}. Rewrite the highlight to explicitly reflect that requirement's language, or retag it to a requirement it actually supports.`
        );
      }
      qualityIssues.push(...evidenceGuardIssues(text, sourceText, entry.role, label));
      sourceBulletIndices.forEach((index: number) => usedSourceIndexes.add(index));
      highlights.push({
        text,
        sourceBulletIndices,
        requirementIds: validatedRequirementIds.slice(0, 2),
      });
    }

    if (supported && highlights.length < 2) {
      qualityIssues.push(
        `${expectedCompany}: at least two highlights must be substantially rewritten and job-relevant.`
      );
    }

    const remainingBulletOrder = [
      ...restoredSourceIndexes,
      ...(Array.isArray(rawRewrite?.remainingBulletOrder)
        ? rawRewrite.remainingBulletOrder.map(Number)
        : []),
    ];
    const expectedRemaining = entry.bullets
      .map((_, bulletIndex) => bulletIndex)
      .filter((bulletIndex) => !usedSourceIndexes.has(bulletIndex));
    if (
      remainingBulletOrder.length !== expectedRemaining.length ||
      new Set(remainingBulletOrder).size !== remainingBulletOrder.length ||
      remainingBulletOrder.some(
        (bulletIndex: number) => !expectedRemaining.includes(bulletIndex)
      )
    ) {
      qualityIssues.push(
        `${expectedCompany}: remainingBulletOrder must contain every unselected original exactly once.`
      );
    }
    rewritesByIndex.set(experienceIndex, {
      experienceIndex,
      company: expectedCompany,
      supported,
      tailoredHighlights: highlights,
      remainingBulletOrder,
    });
  }

  if (qualityIssues.length) throw new TailoringQualityError([...new Set(qualityIssues)]);
  return profile.experience.map((entry, experienceIndex) => {
    const rewrite = rewritesByIndex.get(experienceIndex);
    if (!rewrite) {
      throw new TailoringQualityError([`Missing rewrite for employer ${experienceIndex + 1}.`]);
    }
    return {
      company: canonicalizeExperienceCompanyName(entry.company),
      role: entry.role,
      dates: entry.dates,
      bullets: [
        ...rewrite.tailoredHighlights.map((highlight) => highlight.text),
        ...rewrite.remainingBulletOrder.map((bulletIndex) => entry.bullets[bulletIndex]),
      ],
    };
  });
}

// Applies the model's chosen bullet rewrites onto a protected copy of the
// candidate's real experience. Employer order, company, dates and bullet count
// stay fixed; version 2 deliberately ranks bullets by vacancy relevance.
function applyExperienceRewrites(profile: Profile, raw: any): TailoredCVContent["experience"] {
  if (Number(raw?.experienceRewriteVersion) === EXPERIENCE_REWRITE_VERSION) {
    return applyExperienceHighlightsV3(profile, raw);
  }
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

function preferredRequirementFacts(raw: any, profile: Profile): string[] {
  if (Number(raw?.experienceRewriteVersion) !== EXPERIENCE_REWRITE_VERSION) return [];
  const requirements = parseRankedRequirements(raw, profile);
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const requirement of requirements) {
    for (const reference of requirement.evidence) {
      for (const bulletIndex of reference.bulletIndices) {
        const bullet = profile.experience[reference.experienceIndex]?.bullets[bulletIndex];
        const key = normalizeSummaryText(bullet).toLowerCase();
        if (!bullet || seen.has(key)) continue;
        seen.add(key);
        facts.push(bullet);
      }
    }
  }
  return facts;
}

function resolveSkillOrder(raw: any, profile: Profile): string[] {
  if (Number(raw?.experienceRewriteVersion) !== EXPERIENCE_REWRITE_VERSION) {
    return profile.skills;
  }
  const indices = Array.isArray(raw?.skillsOrder) ? raw.skillsOrder.map(Number) : [];
  if (
    indices.length !== profile.skills.length ||
    new Set(indices).size !== indices.length ||
    indices.some(
      (index: number) =>
        !Number.isInteger(index) || index < 0 || index >= profile.skills.length
    )
  ) {
    throw new TailoringQualityError([
      "skillsOrder must contain every fixed skill index exactly once; skills may only be reordered.",
    ]);
  }
  return indices.map((index: number) => profile.skills[index]);
}

function buildEvidenceAuditTrail(raw: any, profile: Profile): Analysis["auditTrail"] {
  if (Number(raw?.experienceRewriteVersion) !== EXPERIENCE_REWRITE_VERSION) {
    return Array.isArray(raw?.auditTrail)
      ? raw.auditTrail.map((entry: any) => ({
          statement: String(entry?.statement || ""),
          source: String(entry?.source || ""),
        }))
      : [];
  }
  const entries: Analysis["auditTrail"] = [];
  const rewrites = Array.isArray(raw?.experienceRewrites) ? raw.experienceRewrites : [];
  for (const rewrite of rewrites) {
    const experienceIndex = Number(rewrite?.experienceIndex);
    const employer = profile.experience[experienceIndex];
    if (!employer || !Array.isArray(rewrite?.tailoredHighlights)) continue;
    for (const highlight of rewrite.tailoredHighlights) {
      const sourceIndices = Array.isArray(highlight?.sourceBulletIndices)
        ? highlight.sourceBulletIndices
            .map(Number)
            .filter(
              (index: number) =>
                Number.isInteger(index) && index >= 0 && index < employer.bullets.length
            )
        : [];
      const statement = normalizeSummaryText(highlight?.text);
      const sourceBullets = sourceIndices.map((index: number) => employer.bullets[index]);
      if (!statement || !sourceBullets.length) continue;
      if (tokenJaccard(statement, sourceBullets.join(" ")) > 0.9) continue;
      entries.push({
        statement,
        source: `${employer.company}: ${sourceBullets.join(" | ")}`,
      });
      if (entries.length >= 12) return entries;
    }
  }
  return entries;
}

const COMPARISON_STOP_WORDS = new Set([
  "about",
  "after",
  "against",
  "also",
  "and",
  "are",
  "for",
  "from",
  "has",
  "have",
  "into",
  "its",
  "more",
  "that",
  "the",
  "their",
  "this",
  "through",
  "with",
  "within",
]);

function comparableTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3 && !COMPARISON_STOP_WORDS.has(token))
  );
}

const GENERIC_REQUIREMENT_TOKENS = new Set([
  "experience",
  "manager",
  "manage",
  "manag",
  "management",
  "lead",
  "led",
  "own",
  "ownership",
  "accountable",
  "direct",
  "oversee",
  "supervis",
  "head",
  "senior",
  "director",
  "department",
  "departmental",
  "responsibility",
  "responsibilities",
  "role",
  "strong",
]);

function canonicalRequirementConcept(token: string): string {
  if (/^technolog/.test(token) || /^(software|hardware|automation|tools?)$/.test(token)) {
    return "technology";
  }
  if (
    /^(stakeholders?|partners?|partnerships?|customers?|clients?|relationships?|liaison)$/.test(token)
  ) {
    return "stakeholder";
  }
  if (/^(collaborat\w*|coordinat\w*|engag\w*|negotiat\w*)$/.test(token)) {
    return "stakeholder";
  }
  if (/^(reports?|reporting|dashboards?|presentations?)$/.test(token)) {
    return "report";
  }
  if (/^(teams?|people|staff|employees?|workforce|emirati[sz]ation)$/.test(token)) {
    return "people";
  }
  if (/^(kpis?|slas?|targets?|objectives?|performance)$/.test(token)) {
    return "performance";
  }
  if (/^(strateg\w*|plans?|planning)$/.test(token)) {
    return "strategy";
  }
  if (/^(govern\w*|polic\w*|procedures?)$/.test(token)) {
    return "governance";
  }
  if (/^(complian\w*|regulat\w*|safety|security|hse|audits?)$/.test(token)) {
    return "compliance";
  }
  if (/^(budget\w*|expenditure|costs?|financial)$/.test(token)) {
    return "budget";
  }
  if (/^(represent\w*|advoca\w*|committees?|forums?)$/.test(token)) {
    return "representation";
  }
  if (/^(organis\w*|organiz\w*)$/.test(token)) {
    return "organization";
  }
  return token
    .replace(/(?:ies)$/, "y")
    .replace(/(?:ing|ed|es|s)$/, "");
}

function requirementConceptTokens(value: string): Set<string> {
  return new Set(
    [...comparableTokens(value)]
      .map(canonicalRequirementConcept)
      .filter((token) => token.length > 2 && !GENERIC_REQUIREMENT_TOKENS.has(token))
  );
}

function requirementLinkIsSupported(
  requirement: string,
  highlight: string,
  sourceText: string,
  originalRole: string
): boolean {
  const requirementTokens = requirementConceptTokens(requirement);
  const highlightTokens = requirementConceptTokens(highlight);
  const evidenceTokens = requirementConceptTokens(`${sourceText} ${originalRole}`);
  return [...requirementTokens].some(
    (token) => highlightTokens.has(token) && evidenceTokens.has(token)
  );
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = comparableTokens(left);
  const rightTokens = comparableTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function validateTailoringQuality(
  raw: any,
  profile: Profile,
  analysis: Analysis,
  job: Pick<Job, "title" | "company" | "description">
): void {
  if (Number(raw?.experienceRewriteVersion) !== EXPERIENCE_REWRITE_VERSION) {
    throw new TailoringQualityError([
      "Use experienceRewriteVersion 3 and return the complete evidence-linked tailoring schema.",
    ]);
  }
  const requirements = parseRankedRequirements(raw, profile);
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const issues: string[] = [];
  const jobDescriptionTokens = comparableTokens(job.description);
  requirements.forEach((requirement) => {
    const requirementTokens = comparableTokens(requirement.requirement);
    const overlap = [...requirementTokens].filter((token) => jobDescriptionTokens.has(token)).length;
    if (requirementTokens.size >= 3 && overlap < Math.max(1, Math.ceil(requirementTokens.size * 0.2))) {
      issues.push(`${requirement.id} is not sufficiently grounded in the full job description.`);
    }
  });
  const rawSummary = normalizeSummaryText(raw?.tailoredSummary);
  const summary = analysis.tailoredCV.summary;
  if (rawSummary.length < SUMMARY_MIN_CHARS) {
    issues.push(
      "The raw tailoredSummary itself must be a complete rewrite of at least 1050 characters; do not rely on appended original CV text."
    );
  }
  const completeProfileEvidenceText = completeProfileEvidence(profile);
  if (summary.length < SUMMARY_MIN_CHARS || summary.length > SUMMARY_MAX_CHARS) {
    issues.push("Rewrite the profile to exactly 1050-1100 characters including spaces.");
  }
  issues.push(
    ...evidenceGuardIssues(
      summary,
      completeProfileEvidenceText,
      profile.title,
      "Tailored profile"
    )
  );
  if (profile.summary && tokenJaccard(summary, profile.summary) > 0.72) {
    issues.push("The profile remains too similar to the original; fully rewrite it for this vacancy.");
  }

  const roleTokens = comparableTokens(job.title);
  const summaryTokens = comparableTokens(summary);
  const roleOverlap = [...roleTokens].filter((token) => summaryTokens.has(token)).length;
  if (roleTokens.size > 0 && roleOverlap === 0) {
    issues.push("The rewritten profile does not clearly target the vacancy's role family.");
  }

  const rewrites = Array.isArray(raw?.experienceRewrites) ? raw.experienceRewrites : [];
  const coveredRequirementIds = new Set<string>();
  let totalHighlights = 0;
  for (const rewrite of rewrites) {
    const experienceIndex = Number(rewrite?.experienceIndex);
    const employer = profile.experience[experienceIndex];
    if (!employer) continue;
    const highlights = Array.isArray(rewrite?.tailoredHighlights)
      ? rewrite.tailoredHighlights
      : [];
    const evidenceIndexes = new Set<number>();
    requirements.forEach((requirement) => {
      requirement.evidence
        .filter((reference) => reference.experienceIndex === experienceIndex)
        .forEach((reference) => reference.bulletIndices.forEach((index) => evidenceIndexes.add(index)));
    });
    if (evidenceIndexes.size >= 2 && (rewrite?.supported !== true || highlights.length < 2)) {
      issues.push(`${employer.company} has enough declared evidence but lacks 2-3 tailored highlights.`);
    }
    highlights.forEach((highlight: any) => {
      const sourceIndices = Array.isArray(highlight?.sourceBulletIndices)
        ? highlight.sourceBulletIndices.map(Number)
        : [];
      const sourceText = sourceIndices.map((index: number) => employer.bullets[index] || "").join(" ");
      const text = normalizeSummaryText(highlight?.text);
      if (sourceText && tokenJaccard(text, sourceText) > 0.9) return;
      totalHighlights += 1;
      (Array.isArray(highlight?.requirementIds) ? highlight.requirementIds : []).forEach(
        (rawId: unknown) => {
          const id = normalizeSummaryText(rawId).toUpperCase();
          const requirement = requirementById.get(id);
          if (!requirement) return;
          const tracesDeclaredEvidence = requirement.evidence
            .filter((reference) => reference.experienceIndex === experienceIndex)
            .some((reference) =>
              sourceIndices.some((index: number) => reference.bulletIndices.includes(index))
            );
          if (
            tracesDeclaredEvidence &&
            requirementLinkIsSupported(requirement.requirement, text, sourceText, employer.role)
          ) {
            coveredRequirementIds.add(id);
          }
        }
      );
    });
  }
  if (profile.experience.some((entry) => entry.bullets.length >= 2) && totalHighlights < 2) {
    issues.push("The CV needs at least two evidence-backed, visibly tailored experience highlights.");
  }

  const supportedRequirements = requirements.filter((requirement) => requirement.evidence.length > 0);
  const mustCover = supportedRequirements.slice(0, Math.min(3, supportedRequirements.length));
  const uncovered = mustCover.filter((requirement) => !coveredRequirementIds.has(requirement.id));
  if (uncovered.length) {
    issues.push(
      `Tailored highlights do not cover top supported requirement${uncovered.length === 1 ? "" : "s"}: ${uncovered
        .map((requirement) => requirement.id)
        .join(", ")}.`
    );
  }
  if (normalizeSummaryText(job.description).length < MIN_FULL_JOB_DESCRIPTION_CHARS) {
    issues.push("A complete job description is required for reliable tailoring.");
  }
  issues.push(
    ...evidenceGuardIssues(
      analysis.coverLetter,
      completeProfileEvidenceText,
      profile.title,
      "Cover letter",
      `${job.title} ${job.company} ${extractEmployerAcronyms(job.description, job.company).join(" ")}`
    )
  );
  if (analysis.reasons.length !== 3) {
    issues.push("Return exactly three concise fit reasons.");
  }
  if (issues.length) throw new TailoringQualityError([...new Set(issues)]);
}

function rawNarrativeEvidenceIssues(
  raw: any,
  profile: Profile,
  job: Pick<Job, "title" | "company" | "description">
): string[] {
  const completeProfileEvidenceText = completeProfileEvidence(profile);
  const summary = trimSummaryToMaximum(raw?.tailoredSummary || "");
  const coverLetter = normalizeSummaryText(raw?.coverLetter);
  return [
    ...evidenceGuardIssues(
      summary,
      completeProfileEvidenceText,
      profile.title,
      "Tailored profile"
    ),
    ...evidenceGuardIssues(
      coverLetter,
      completeProfileEvidenceText,
      profile.title,
      "Cover letter",
      `${job.title} ${job.company} ${extractEmployerAcronyms(job.description, job.company).join(" ")}`
    ),
  ];
}

export function toAnalysis(parsed: any, profile: Profile): Analysis {
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  const tier = getMatchTier(score);
  const preferredFacts = preferredRequirementFacts(parsed, profile);
  const tailoredCV: TailoredCVContent = {
    summary: ensureTailoredSummaryLength(
      parsed.tailoredSummary || profile.summary || "",
      profile,
      preferredFacts
    ),
    skills: resolveSkillOrder(parsed, profile),
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
    auditTrail: buildEvidenceAuditTrail(parsed, profile),
  };
}

function hasUnmistakableV3Shape(raw: any, profile: Profile): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  if (raw.experienceRewriteVersion !== undefined && raw.experienceRewriteVersion !== null) {
    return false;
  }
  const requirements = Array.isArray(raw.rankedRequirements) ? raw.rankedRequirements : [];
  if (requirements.length < 6 || requirements.length > 10) return false;

  const skillsOrder = Array.isArray(raw.skillsOrder) ? raw.skillsOrder.map(Number) : [];
  if (
    skillsOrder.length !== profile.skills.length ||
    new Set(skillsOrder).size !== skillsOrder.length ||
    skillsOrder.some(
      (index: number) =>
        !Number.isInteger(index) || index < 0 || index >= profile.skills.length
    )
  ) {
    return false;
  }

  const rewrites = Array.isArray(raw.experienceRewrites) ? raw.experienceRewrites : [];
  if (rewrites.length !== profile.experience.length) return false;
  const seenExperienceIndexes = new Set<number>();
  return rewrites.every((rewrite: any) => {
    if (!rewrite || typeof rewrite !== "object") return false;
    if ("bulletsToRewrite" in rewrite || "rewrittenBullets" in rewrite) return false;
    const experienceIndex = Number(rewrite.experienceIndex);
    const entry = profile.experience[experienceIndex];
    if (
      !Number.isInteger(experienceIndex) ||
      !entry ||
      seenExperienceIndexes.has(experienceIndex) ||
      normalizeSummaryText(rewrite.company) !== canonicalizeExperienceCompanyName(entry.company) ||
      typeof rewrite.supported !== "boolean" ||
      !Array.isArray(rewrite.tailoredHighlights) ||
      !Array.isArray(rewrite.remainingBulletOrder)
    ) {
      return false;
    }
    seenExperienceIndexes.add(experienceIndex);
    return rewrite.tailoredHighlights.every(
      (highlight: any) =>
        highlight &&
        typeof highlight === "object" &&
        Boolean(normalizeSummaryText(highlight.text)) &&
        Array.isArray(highlight.sourceBulletIndices) &&
        highlight.sourceBulletIndices.length > 0 &&
        Array.isArray(highlight.requirementIds) &&
        highlight.requirementIds.length > 0
    );
  });
}

// Names the specific cv-tailoring-v3.1 fields a response got wrong, so a
// corrective pass (paid retry or a re-pasted claude.ai reply) is told exactly
// what to fix instead of just "redo it" — most often seen when the schema
// changes and Claude falls back to an earlier version's field names.
function describeSchemaShapeIssues(raw: any, profile: Profile): string[] {
  const issues: string[] = [];
  // score and tailoredSummary get checked here unconditionally (not just when
  // experienceRewriteVersion is wrong) because a missing one doesn't fail
  // loudly downstream — toAnalysis silently falls back to score 0 or the
  // untailored profile summary, so a bad response can otherwise look like a
  // normal completed analysis.
  if (typeof raw?.tailoredSummary !== "string" || !raw.tailoredSummary.trim()) {
    issues.push(
      'Add "tailoredSummary": a complete rewritten profile string (1050-1100 characters) — it is missing from this response.'
    );
  }
  if (!Number.isFinite(Number(raw?.score))) {
    issues.push(
      'Add "score": an integer 0-100 fit score — it is missing from this response.'
    );
  }
  if (
    raw?.roleResearch !== undefined &&
    (typeof raw.roleResearch !== "object" ||
      raw.roleResearch === null ||
      Array.isArray(raw.roleResearch))
  ) {
    issues.push(
      '"roleResearch" must be an object ({normalizedRole, marketContext, expectations, sources}), not a string or array.'
    );
  }
  if (Array.isArray(raw?.reasons) && raw.reasons.length !== 3) {
    issues.push(
      `"reasons" must contain exactly 3 items — this response has ${raw.reasons.length}.`
    );
  }
  if (raw && typeof raw === "object" && "gaps" in raw) {
    issues.push(
      'Remove the old "gaps" field; unsupported terms belong only in "reasons", "roleResearch", or "verdict" in this schema.'
    );
  }
  if (
    Array.isArray(raw?.rankedRequirements) &&
    raw.rankedRequirements.some(
      (item: any) => item && typeof item === "object" && "evidenceMatch" in item
    )
  ) {
    issues.push(
      '"rankedRequirements" items must use id/priority/importance/source/evidence fields, not the old requirement/evidenceMatch format.'
    );
  }
  const rewrites = Array.isArray(raw?.experienceRewrites) ? raw.experienceRewrites : [];
  if (rewrites.length !== profile.experience.length) {
    issues.push(
      `"experienceRewrites" must include exactly one entry per employer — expected ${profile.experience.length}, got ${rewrites.length}.`
    );
  }
  if (
    rewrites.some(
      (rewrite: any) =>
        Array.isArray(rewrite?.tailoredHighlights) &&
        rewrite.tailoredHighlights.some(
          (highlight: any) => highlight && typeof highlight === "object" && "bulletIndex" in highlight
        )
    )
  ) {
    issues.push(
      'Each tailoredHighlights item needs "sourceBulletIndices" (array) and "requirementIds" (array), not a single "bulletIndex".'
    );
  }
  return issues;
}

function prepareValidationPayload(
  parsed: any,
  profile: Profile,
  job: Pick<Job, "title" | "company">
): any {
  const prepared = hasUnmistakableV3Shape(parsed, profile)
    ? { ...parsed, experienceRewriteVersion: EXPERIENCE_REWRITE_VERSION }
    : { ...parsed };
  // score/tailoredSummary and the other structural checks run regardless of
  // the version tag, then the version tag itself is checked separately —
  // otherwise an explicit (but wrong) experienceRewriteVersion could mask a
  // genuinely broken response that has no other detectable issue.
  const shapeIssues = describeSchemaShapeIssues(prepared, profile);
  if (Number(prepared.experienceRewriteVersion) !== EXPERIENCE_REWRITE_VERSION) {
    shapeIssues.push(
      shapeIssues.length
        ? 'Add "experienceRewriteVersion": 3 to the response.'
        : "Use experienceRewriteVersion 3 and return the complete evidence-linked tailoring schema."
    );
  }
  if (shapeIssues.length) {
    throw new TailoringQualityError(shapeIssues);
  }
  const evidence = completeProfileEvidence(profile);
  const rawSummary = normalizeSummaryText(prepared.tailoredSummary);
  const cleanedSummary = removeUnsupportedAcronymSentences(
    rawSummary,
    evidence
  );
  const summaryRetainedEnough =
    rawSummary.length >= SUMMARY_MIN_CHARS &&
    cleanedSummary.length >= 850 &&
    cleanedSummary.length / rawSummary.length >= 0.7;
  if (cleanedSummary !== rawSummary && summaryRetainedEnough) {
    prepared.tailoredSummary = ensureTailoredSummaryLength(
      cleanedSummary,
      profile,
      preferredRequirementFacts(prepared, profile)
    );
  }

  const rawCoverLetter = normalizeSummaryText(prepared.coverLetter);
  const cleanedCoverLetter = removeUnsupportedAcronymSentences(
    rawCoverLetter,
    evidence,
    `${job.title} ${job.company}`
  );
  const rawCoverWordCount = rawCoverLetter.split(/\s+/).filter(Boolean).length;
  const cleanedCoverWordCount = cleanedCoverLetter.split(/\s+/).filter(Boolean).length;
  // A mostly contaminated cover letter should be corrected by Claude instead
  // of being silently reduced to a fragment. A single unsupported sentence in
  // an otherwise complete letter can be removed deterministically and safely.
  if (
    cleanedCoverLetter !== rawCoverLetter &&
    cleanedCoverWordCount >= 60 &&
    rawCoverWordCount > 0 &&
    cleanedCoverWordCount / rawCoverWordCount >= 0.7
  ) {
    prepared.coverLetter = cleanedCoverLetter;
  }
  return prepared;
}

export function toValidatedAnalysis(
  parsed: any,
  profile: Profile,
  job: Pick<Job, "title" | "company" | "description">
): Analysis {
  const prepared = prepareValidationPayload(parsed, profile, job);
  const narrativeIssues = rawNarrativeEvidenceIssues(prepared, profile, job);
  let analysis: Analysis;
  try {
    analysis = toAnalysis(prepared, profile);
  } catch (error) {
    if (error instanceof TailoringQualityError && narrativeIssues.length) {
      throw new TailoringQualityError([...new Set([...error.issues, ...narrativeIssues])]);
    }
    throw error;
  }
  try {
    validateTailoringQuality(prepared, profile, analysis, job);
  } catch (error) {
    if (error instanceof TailoringQualityError && narrativeIssues.length) {
      throw new TailoringQualityError([...new Set([...error.issues, ...narrativeIssues])]);
    }
    throw error;
  }
  return analysis;
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

  // Only "is this a JSON object" belongs here. Schema-shape problems (missing
  // score, an old field format, a missing employer, ...) are diagnosed by
  // describeSchemaShapeIssues below so they produce a TailoringQualityError
  // with a correction prompt instead of a dead-end generic failure.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Claude returned an incomplete analysis.");
  }
  return parsed;
}

interface ClaudeCallResult {
  parsed: any;
  webSearchRequests: number;
  researchSources: RoleResearchSource[];
}

function extractResearchSources(content: any[]): RoleResearchSource[] {
  const sources: RoleResearchSource[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string" && /^https?:\/\//i.test(record.url) && !seen.has(record.url)) {
      seen.add(record.url);
      sources.push({
        title: normalizeSummaryText(record.title) || "Role research source",
        url: record.url,
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(content);
  return sources.slice(0, 6);
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function callClaude(
  job: Pick<Job, "title" | "company" | "location" | "description">,
  profile: Profile,
  apiKey: string,
  promptOptions: BuildPromptOptions,
  timeoutMs: number
): Promise<ClaudeCallResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_MODEL_TOKENS,
          ...MODEL_PERFORMANCE_OPTIONS,
          system: SYSTEM,
          messages: [{ role: "user", content: buildPrompt(job, profile, promptOptions) }],
          ...(promptOptions.requestWebResearch ? { tools: [WEB_SEARCH_TOOL] } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error: any) {
      if (promptOptions.requestWebResearch && error?.name !== "AbortError") {
        throw new WebResearchUnavailableError(
          "The bounded role-research request could not be confirmed; retry from the full job description without another web search."
        );
      }
      throw error;
    }
    if (!response.ok) {
      const providerStatus = response.status;
      const providerDetail = (await response.text()).slice(0, 700);
      console.error("Claude tailoring request failed", providerStatus, providerDetail);
      if (providerStatus === 400 && /credit balance is too low/i.test(providerDetail)) {
        throw new LiveAnalysisError(
          "The AI service has run out of credit. Add credit in the Anthropic Console (Plans & Billing), then try again.",
          402
        );
      }
      if (
        promptOptions.requestWebResearch &&
        providerStatus === 400 &&
        /web.?search|server.?tool|tools?/i.test(providerDetail)
      ) {
        throw new WebResearchUnavailableError(
          "Web role research was unavailable; use the full job description only."
        );
      }
      if (promptOptions.requestWebResearch && TRANSIENT_PROVIDER_STATUSES.has(providerStatus)) {
        throw new WebResearchUnavailableError(
          "The role-research request did not complete reliably; retry from the full job description without another web search."
        );
      }
      if (TRANSIENT_PROVIDER_STATUSES.has(providerStatus)) {
        throw new RetryableClaudeError(
          "The provider returned a transient response; make one concise corrective request without web research."
        );
      }
      throw new LiveAnalysisError(
        "Live tailoring is temporarily unavailable. Please try again.",
        502
      );
    }

    const data = await response.json();
    if (data.stop_reason === "max_tokens") {
      throw new TailoringQualityError([
        "Return a complete but concise JSON response within the output limit.",
      ]);
    }
    if (data.stop_reason === "pause_turn") {
      throw new WebResearchUnavailableError(
        "Web role research did not finish in one bounded pass; use the full job description only."
      );
    }
    const content = Array.isArray(data.content) ? data.content : [];
    const text = content
      .map((block: any) => (block?.type === "text" ? block.text : ""))
      .join("")
      .trim();
    let parsed: any;
    try {
      parsed = parseModelResponse(text);
    } catch (error) {
      if (promptOptions.requestWebResearch) {
        throw new WebResearchUnavailableError(
          "The researched response was incomplete; retry using the job description only."
        );
      }
      throw error;
    }
    return {
      parsed,
      webSearchRequests: Math.max(
        0,
        Number(data?.usage?.server_tool_use?.web_search_requests) || 0
      ),
      researchSources: extractResearchSources(content),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeJobForCandidate(
  job: Pick<Job, "title" | "company" | "location" | "description" | "id">,
  profile: Profile
): Promise<Analysis> {
  const candidateProfile = sanitizeProfile(profile);
  const key = process.env.ANTHROPIC_API_KEY;
  const masterCV = buildMasterCVMarkdown(candidateProfile);

  if (process.env.DEMO_MODE === "true") {
    const demo = buildDemoAnalysis(job as Job, masterCV, "Simulated preview - Claude was not called.");
    return {
      ...demo,
      tailoredCV: {
        ...demo.tailoredCV,
        summary: ensureTailoredSummaryLength(demo.tailoredCV.summary, candidateProfile),
      },
    };
  }
  if (!key) {
    throw new LiveAnalysisError(
      "Live tailoring is not configured. Add ANTHROPIC_API_KEY or explicitly enable demo mode.",
      503
    );
  }
  if (normalizeSummaryText(job.description).length < MIN_FULL_JOB_DESCRIPTION_CHARS) {
    throw new LiveAnalysisError(
      "This listing does not include a complete job description. Open the posting or paste the full description before tailoring.",
      422
    );
  }

  const deadline = Date.now() + 54_000;
  let researchBrief: RoleResearchBrief | null = await settleWithin(
    loadRoleResearchBrief(job),
    1_500,
    null
  );
  const firstOptions: BuildPromptOptions = researchBrief
    ? { cachedRoleResearch: researchBrief }
    : { requestWebResearch: process.env.ROLE_RESEARCH_ENABLED !== "false" };
  let correctionIssues: string[] = [];

  try {
    try {
      const firstResult = await callClaude(job, candidateProfile, key, firstOptions, 28_000);
      if (!researchBrief && firstResult.webSearchRequests > 0) {
        researchBrief = await settleWithin(
          saveRoleResearchBrief(job, firstResult.parsed?.roleResearch, firstResult.researchSources),
          1_500,
          null
        );
      }
      const firstAnalysis = toValidatedAnalysis(firstResult.parsed, candidateProfile, job);
      return firstAnalysis;
    } catch (error: any) {
      if (error instanceof LiveAnalysisError) throw error;
      if (error?.name === "AbortError") {
        correctionIssues = ["The first pass timed out. Return concise, complete JSON without web research."];
      } else if (error instanceof TailoringQualityError) {
        correctionIssues = error.issues.slice(0, 10);
      } else if (error instanceof WebResearchUnavailableError) {
        correctionIssues = [error.message];
      } else if (error instanceof RetryableClaudeError) {
        correctionIssues = [error.message];
      } else {
        correctionIssues = [
          "Return one complete valid JSON object matching schema version 3; do not include prose or markdown.",
        ];
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs < 5_000) {
      throw new LiveAnalysisError(
        "Live tailoring timed out before the quality correction could finish. Please try again.",
        504
      );
    }
    const correctedResult = await callClaude(
      job,
      candidateProfile,
      key,
      {
        requestWebResearch: false,
        correctionIssues,
      },
      Math.min(remainingMs, 24_000)
    );
    const correctedAnalysis = toValidatedAnalysis(correctedResult.parsed, candidateProfile, job);
    return correctedAnalysis;
  } catch (error: any) {
    if (error instanceof LiveAnalysisError) throw error;
    if (error?.name === "AbortError") {
      throw new LiveAnalysisError("Live tailoring timed out. Please try again.", 504);
    }
    if (error instanceof TailoringQualityError) {
      console.error("Claude tailoring failed quality checks", error.issues);
      throw new LiveAnalysisError(
        "Claude could not produce a sufficiently specific, evidence-backed CV. Please try again.",
        502
      );
    }
    console.error("Failed to parse or build live tailoring response", error);
    throw new LiveAnalysisError("Claude returned an invalid CV response. Please try again.", 502);
  }
}
