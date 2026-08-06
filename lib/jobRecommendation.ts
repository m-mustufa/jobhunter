import type { Job, Profile } from "./types";

export interface JobRecommendation {
  /** Internal ranking value only. Never display this number to the user. */
  score: number;
  recommended: boolean;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "in", "is", "it", "job", "of", "on", "or", "our", "role", "that",
  "the", "their", "this", "to", "with", "will", "you", "your", "years",
  "abu", "dhabi", "uae", "united", "arab", "emirates",
]);

const SENIOR_ROLE_WORDS = new Set([
  "chief", "director", "head", "lead", "leader", "manager", "president", "vp",
]);

const LEADERSHIP_EVIDENCE = [
  "directed", "governance", "led", "leadership", "managed", "manager", "oversaw",
  "owned", "stakeholder", "supervised", "team lead", "team leader",
];

const HARD_REQUIREMENTS = [
  "acca", "arabic", "cfa", "cpa", "mba", "pmp", "prince2", "uae national",
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/qa[\s/-]*qc/g, "qa qc")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
}

function includesPhrase(corpus: string, phrase: string): boolean {
  const normalizedPhrase = normalize(phrase);
  return normalizedPhrase.length >= 2 && ` ${corpus} `.includes(` ${normalizedPhrase} `);
}

function overlapRatio(left: Set<string>, right: Set<string>, denominatorCap: number): number {
  if (left.size === 0 || right.size === 0) return 0;
  let matches = 0;
  left.forEach((token) => {
    if (right.has(token)) matches += 1;
  });
  return matches / Math.max(1, Math.min(left.size, denominatorCap));
}

function hasUsableDescription(description: string): boolean {
  const text = normalize(description);
  return (
    text.length >= 120 &&
    !text.includes("full description will be loaded") &&
    !text.includes("description unavailable")
  );
}

function missingMandatoryRequirements(jobText: string, profileText: string): number {
  let missing = 0;
  for (const requirement of HARD_REQUIREMENTS) {
    if (!includesPhrase(jobText, requirement) || includesPhrase(profileText, requirement)) continue;
    const requirementIndex = jobText.indexOf(normalize(requirement));
    const nearby = jobText.slice(Math.max(0, requirementIndex - 55), requirementIndex + 80);
    if (/required|mandatory|must|minimum/.test(nearby)) missing += 1;
  }
  return missing;
}

/**
 * Ranks a job against the saved profile without calling Claude or a job provider.
 * The numeric value is deliberately internal; the UI exposes only a positive
 * "Recommended" state and never labels the remaining jobs negatively.
 */
export function getJobRecommendation(profile: Profile, job: Job): JobRecommendation {
  const experienceText = profile.experience
    .flatMap((entry) => [entry.role, entry.company, ...entry.bullets])
    .join(" ");
  const profileText = normalize(
    [
      profile.title,
      profile.summary,
      profile.skills.join(" "),
      experienceText,
      profile.education.join(" "),
      profile.certifications.join(" "),
      profile.languages.join(" "),
    ].join(" ")
  );
  const jobTitle = normalize(job.title);
  const usableDescription = hasUsableDescription(job.description);
  const jobText = normalize(`${job.title} ${usableDescription ? job.description : ""}`);

  const profileTokens = meaningfulTokens(profileText);
  const titleTokens = meaningfulTokens(jobTitle);
  const jobTokens = meaningfulTokens(jobText);
  const titleOverlap = overlapRatio(titleTokens, profileTokens, 8);
  const responsibilityOverlap = overlapRatio(jobTokens, profileTokens, 36);

  const relevantSkills = profile.skills
    .map(normalize)
    .filter((skill) => skill.length >= 3 && includesPhrase(jobText, skill));
  const skillCoverage = Math.min(1, relevantSkills.length / 5);

  const seniorRole = [...titleTokens].some((token) => SENIOR_ROLE_WORDS.has(token));
  const leadershipMatches = LEADERSHIP_EVIDENCE.filter((term) =>
    includesPhrase(profileText, term)
  ).length;
  const leadershipFit = !seniorRole ? 1 : Math.min(1, leadershipMatches / 3);

  const missingMandatory = missingMandatoryRequirements(jobText, profileText);
  const rawScore =
    titleOverlap * 38 +
    skillCoverage * 27 +
    responsibilityOverlap * 22 +
    leadershipFit * 13 -
    Math.min(24, missingMandatory * 12);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const hasTitleEvidence = titleOverlap >= (usableDescription ? 0.28 : 0.5);
  const hasSupportingEvidence =
    relevantSkills.length >= 2 || responsibilityOverlap >= 0.16;
  const recommended =
    score >= 50 &&
    hasTitleEvidence &&
    hasSupportingEvidence &&
    missingMandatory === 0;

  return { score, recommended };
}
