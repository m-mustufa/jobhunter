import { Profile } from "./types";
import { DEFAULT_PROFILE } from "./profile";

// Serializes structured Profile data into the Markdown convention the
// tailoring prompt (lib/analyzeJob.ts) and the demo-mode parser
// (lib/demoAnalysis.ts's parseMasterCV) already expect:
//   # Name
//   Title — Location
//   email · phone · link · link
//
//   ## Summary
//   ...
//
//   ## Core Skills
//   comma, separated, list
//
//   ## Experience
//
//   ### Company — Role (dates)
//   - bullet
//
//   ## Education
//   ...
export function buildMasterCVMarkdown(profile: Profile): string {
  const lines: string[] = [`# ${profile.name || "Candidate"}`];

  const subtitle = [profile.title, profile.location].filter(Boolean).join(" — ");
  if (subtitle) lines.push(subtitle);

  const contact = [profile.email, profile.phone, ...profile.links].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);

  lines.push("");

  if (profile.summary) {
    lines.push("## Summary", profile.summary, "");
  }

  if (profile.skills.length) {
    lines.push("## Core Skills", profile.skills.join(", "), "");
  }

  if (profile.experience.length) {
    lines.push("## Experience", "");
    for (const e of profile.experience) {
      const header = [e.company, e.role].filter(Boolean).join(" — ");
      lines.push(`### ${header}${e.dates ? ` (${e.dates})` : ""}`);
      for (const b of e.bullets) lines.push(`- ${b}`);
      lines.push("");
    }
  }

  if (profile.education.length) {
    lines.push("## Education", profile.education.join("\n"), "");
  }

  return lines.join("\n").trim() + "\n";
}

// Default master CV used to seed the editor so the demo works immediately.
// Derived from DEFAULT_PROFILE so the two can never drift apart — replace
// DEFAULT_PROFILE in lib/profile.ts with your own details.
export const DEFAULT_MASTER_CV = buildMasterCVMarkdown(DEFAULT_PROFILE);
