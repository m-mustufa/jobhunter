import { Analysis, Job } from "./types";
import { getMatchTier } from "./matchTier";

const SKILLS = [
  "Angular", "React", "Next.js", "Node.js", "TypeScript", "JavaScript",
  "MongoDB", "PostgreSQL", "Supabase", "REST APIs", "Stripe", "Clerk",
  "TailwindCSS", "SaaS", "multi-tenant", "auth", "AI", "UI", "UX",
];

function includes(text: string, term: string) {
  const normalized = text.toLowerCase().replace(/[.-]/g, "");
  return normalized.includes(term.toLowerCase().replace(/[.-]/g, ""));
}

function stableOffset(value: string) {
  return [...value].reduce((total, char) => total + char.charCodeAt(0), 0) % 5;
}

function candidateName(masterCV: string) {
  const heading = masterCV.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "the candidate";
}

export function buildDemoAnalysis(job: Job, masterCV: string, note?: string): Analysis {
  const posting = `${job.title} ${job.description}`;
  const matched = SKILLS.filter((skill) => includes(posting, skill) && includes(masterCV, skill));
  const requested = SKILLS.filter((skill) => includes(posting, skill));
  const gaps = requested.filter((skill) => !includes(masterCV, skill));
  const highlights = matched.slice(0, 5);
  const score = Math.min(94, 64 + highlights.length * 5 + stableOffset(job.id || job.title));
  const name = candidateName(masterCV);
  const skillPhrase = highlights.length
    ? highlights.slice(0, 3).join(", ")
    : "end-to-end product delivery";
  const verdict = score >= 85
    ? `Strong alignment — lead with ${skillPhrase}`
    : score >= 72
      ? `Good potential — emphasize ${skillPhrase}`
      : "Promising fit — foreground transferable product experience";

  const reasons = [
    highlights.length
      ? `Direct keyword alignment across ${highlights.join(", ")}.`
      : "The CV demonstrates relevant end-to-end product ownership.",
    includes(masterCV, "production SaaS")
      ? "Evidence of shipping and maintaining production SaaS products."
      : "Relevant experience is presented around shipped product outcomes.",
    includes(masterCV, "multi-tenant") && includes(posting, "multi-tenant")
      ? "Multi-tenant platform experience maps directly to this role."
      : "Full-stack ownership supports the role's cross-functional scope.",
    gaps.length
      ? `${gaps[0]} appears in the posting but is not explicit in the Master CV; validate before claiming it.`
      : "No major skill mismatch is apparent from the supplied posting and CV.",
  ];

  const alignment = highlights.length
    ? highlights.map((skill) => `- **${skill}** — explicitly present in both the role and Master CV.`).join("\n")
    : "- End-to-end engineering ownership and production delivery are the strongest transferable themes.";

  const tailoredCV = `${masterCV.trim()}\n\n## Alignment for ${job.title}\n${alignment}\n\n> Tailoring note: This preview only reorganizes and highlights information already present in the Master CV.`;

  const coverLetter = `Dear ${job.company} hiring team,\n\nI'm interested in the ${job.title} opportunity${job.location ? ` in ${job.location}` : ""}. My background combines ${skillPhrase} with hands-on ownership of production software from interface through backend delivery.\n\nIn my current and founding-engineer work, I have contributed to large SaaS products, built user-facing workflows, and taken features from requirements through implementation. The role's emphasis on ${highlights.slice(0, 2).join(" and ") || "practical full-stack ownership"} closely matches the work highlighted in my CV. I would bring a product-minded approach, attention to reliable delivery, and the ability to collaborate across the stack.\n\nI would welcome a conversation about the challenges your team is solving and how my experience could contribute.\n\nBest regards,\n${name}`;

  const gapAnalysis = gaps.length
    ? `The posting mentions ${gaps.slice(0, 3).join(", ")}, which ${gaps.length > 1 ? "are" : "is"} not explicit in the Master CV. Everything else in this preview draws only on experience already documented there.`
    : "No significant gaps detected between the posting's stated requirements and the Master CV in this preview.";

  const auditTrail = highlights.length
    ? highlights.slice(0, 4).map((skill) => ({
        statement: `Experience with ${skill}`,
        source: "Core Skills / Experience section of the Master CV",
      }))
    : [
        {
          statement: "End-to-end product delivery experience",
          source: "Experience section of the Master CV",
        },
      ];

  const tier = getMatchTier(score);

  return {
    score,
    tier: tier.key,
    tierLabel: tier.label,
    verdict,
    reasons,
    tailoredCV,
    coverLetter,
    gapAnalysis,
    auditTrail,
    demo: true,
    demoNote: note || "Simulated preview generated locally without an AI API call.",
  };
}
