import { ExperienceEntry, Job, Profile, TailoredCVContent } from "./types";
import { canonicalizeExperienceCompanyName } from "./profile";

export interface CVDocument {
  profile: Profile;
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: string[];
}

// Merges the candidate's structured contact info (edited once, in the
// Profile tab) with a job's tailored content (regenerated per vacancy) into
// one render-ready model for the PDF/DOCX templates.
export function buildCVDocument(profile: Profile, tailored: TailoredCVContent): CVDocument {
  return {
    profile,
    summary: tailored.summary,
    skills: tailored.skills,
    experience: tailored.experience.map((entry) => ({
      ...entry,
      company: canonicalizeExperienceCompanyName(entry.company),
    })),
    education: tailored.education,
  };
}

// Plain-text rendering of the structured tailored CV, for the in-app "Copy" button.
export function serializeCVText(profile: Profile, tailored: TailoredCVContent): string {
  const lines: string[] = [];
  lines.push(profile.name || "Candidate");
  const subtitle = [profile.title, profile.location].filter(Boolean).join(" — ");
  if (subtitle) lines.push(subtitle);
  const contact = [profile.email, profile.phone, ...profile.links].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  lines.push("");

  if (tailored.summary) {
    lines.push("SUMMARY", tailored.summary, "");
  }
  if (tailored.skills.length) {
    lines.push("CORE SKILLS", tailored.skills.join(", "), "");
  }
  if (tailored.experience.length) {
    lines.push("EXPERIENCE");
    for (const e of tailored.experience) {
      const company = canonicalizeExperienceCompanyName(e.company);
      lines.push([e.role, company].filter(Boolean).join(" — ") + (e.dates ? ` (${e.dates})` : ""));
      for (const b of e.bullets) lines.push(`- ${b}`);
      lines.push("");
    }
  }
  if (tailored.education.length) {
    lines.push("EDUCATION", ...tailored.education, "");
  }
  return lines.join("\n").trim();
}

export interface CoverLetterDocument {
  profile: Profile;
  job: Pick<Job, "title" | "company" | "location">;
  body: string; // paragraphs separated by \n\n
  date: string;
}

export function buildCoverLetterDocument(
  profile: Profile,
  job: Pick<Job, "title" | "company" | "location">,
  body: string
): CoverLetterDocument {
  return {
    profile,
    job,
    body,
    date: new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
  };
}
