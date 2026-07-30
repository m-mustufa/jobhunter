import { Analysis, ExperienceEntry, Job } from "./types";
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

// Loosely parses the Master CV's Markdown conventions (as used by
// lib/masterCV.ts's DEFAULT_MASTER_CV) into structured pieces. Best-effort:
// falls back to sane defaults if the user's text doesn't follow the same shape.
function parseMasterCV(masterCV: string) {
  const name = masterCV.match(/^#\s+(.+)$/m)?.[1]?.trim() || "the candidate";

  const summarySection = masterCV.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|\n*$)/i)?.[1]?.trim();
  const summary = summarySection ? summarySection.replace(/\s+/g, " ").trim() : "";

  const skillsSection = masterCV.match(/##\s*Core Skills\s*\n([\s\S]*?)(?=\n##|\n*$)/i)?.[1]?.trim();
  const skills = skillsSection
    ? skillsSection
        .replace(/\n/g, " ")
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const experienceSection = masterCV.match(/##\s*Experience\s*\n([\s\S]*?)(?=\n##\s|\n*$)/i)?.[1] || "";
  const experience: ExperienceEntry[] = [];
  const roleBlocks = experienceSection.split(/\n(?=###\s)/).filter((b) => b.trim());
  for (const block of roleBlocks) {
    const header = block.match(/^###\s*(.+?)\s*—\s*(.+?)\s*\(([^)]+)\)/);
    const bullets = [...block.matchAll(/^-\s+(.+)$/gm)].map((m) => m[1].trim());
    if (header) {
      experience.push({ company: header[1].trim(), role: header[2].trim(), dates: header[3].trim(), bullets });
    } else if (bullets.length) {
      experience.push({ company: "", role: "", dates: "", bullets });
    }
  }

  const educationSection = masterCV.match(/##\s*(Earlier|Education)\s*\n([\s\S]*?)(?=\n##|\n*$)/i)?.[2]?.trim();
  const education = educationSection
    ? educationSection.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean)
    : [];

  return { name, summary, skills, experience, education };
}

export function buildDemoAnalysis(job: Job, masterCV: string, note?: string): Analysis {
  const posting = `${job.title} ${job.description}`;
  const parsed = parseMasterCV(masterCV);

  const matched = SKILLS.filter((skill) => includes(posting, skill) && includes(masterCV, skill));
  const requested = SKILLS.filter((skill) => includes(posting, skill));
  const gaps = requested.filter((skill) => !includes(masterCV, skill));
  const highlights = matched.slice(0, 5);
  const score = Math.min(94, 64 + highlights.length * 5 + stableOffset(job.id || job.title));
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

  // Reorder skills so posting-relevant ones lead, without dropping any.
  const reorderedSkills = [
    ...parsed.skills.filter((s) => highlights.some((h) => includes(s, h))),
    ...parsed.skills.filter((s) => !highlights.some((h) => includes(s, h))),
  ];

  const tailoredSummary = parsed.summary
    ? `${parsed.summary} Particularly aligned with ${skillPhrase} for this ${job.title} role.`
    : `Experienced professional with a background aligned to ${skillPhrase}, well suited to this ${job.title} role.`;

  const tailoredExperience: ExperienceEntry[] = parsed.experience.map((entry) => ({
    ...entry,
    bullets: [
      ...entry.bullets.filter((b) => highlights.some((h) => includes(b, h))),
      ...entry.bullets.filter((b) => !highlights.some((h) => includes(b, h))),
    ],
  }));

  const coverLetter = `I'm interested in the ${job.title} opportunity${job.location ? ` in ${job.location}` : ""} at ${job.company}. My background combines ${skillPhrase} with hands-on ownership of production software from interface through backend delivery.\n\nIn my current and founding-engineer work, I have contributed to large SaaS products, built user-facing workflows, and taken features from requirements through implementation. The role's emphasis on ${highlights.slice(0, 2).join(" and ") || "practical full-stack ownership"} closely matches the work highlighted in my CV. I would bring a product-minded approach, attention to reliable delivery, and the ability to collaborate across the stack.\n\nI would welcome a conversation about the challenges your team is solving and how my experience could contribute.`;

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
    tailoredCV: {
      summary: tailoredSummary,
      skills: reorderedSkills.length ? reorderedSkills : highlights,
      experience: tailoredExperience,
      education: parsed.education,
    },
    coverLetter,
    auditTrail,
    demo: true,
    demoNote: note || "Simulated preview generated locally without an AI API call.",
  };
}
