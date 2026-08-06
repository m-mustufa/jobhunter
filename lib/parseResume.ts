import { Profile } from "./types";
import { sanitizeProfile, DEFAULT_CV_TEMPLATE } from "./profile";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const SYSTEM = `You turn raw, messily-extracted resume text into a single
structured profile. Preserve every fact in the source text truthfully — do
not invent employers, titles, dates, skills, or achievements. Fix obvious
extraction artifacts (broken line breaks, stray page-number text) but do not
add content that isn't there. Leave a field empty/omit an entry if the
source text genuinely doesn't contain it — don't guess.

Copy employer/company/department names exactly as written in the source.
Never prepend a parent organization, expand abbreviations, translate a
label, or correct its spelling.

Return ONLY a valid JSON object. No markdown fences, no preamble.`;

function buildPrompt(rawText: string) {
  return `RAW RESUME TEXT (extracted from an uploaded file, formatting may be imperfect):
${rawText}

Return a single JSON object with exactly these keys:
{
  "name": "<full name>",
  "title": "<current or most recent job title>",
  "location": "<city, country>",
  "email": "<email address, or empty string if none found>",
  "phone": "<phone number, or empty string if none found>",
  "links": ["<links found, e.g. LinkedIn, portfolio, GitHub — no duplicates>"],
  "summary": "<the professional summary/about section, rewritten cleanly, or a 1-2 sentence summary inferred from the experience if the source has no explicit summary>",
  "skills": ["<individual skills, tools, and technologies listed in the source>"],
  "experience": [
    { "company": "<employer/company/department name copied verbatim from the source>", "role": "<title>", "dates": "<e.g. 2021–present>", "bullets": ["<achievement/responsibility, as stated in the source>"] }
  ],
  "education": ["<education or earlier-career lines, kept brief>"],
  "certifications": ["<professional certifications/licences found in the source, e.g. 'PMP', 'NEBOSH', or an empty array if none>"],
  "languages": ["<languages found in the source, e.g. 'Arabic (Fluent)', or an empty array if none>"]
}

Return only the JSON object.`;
}

export interface ExtractedProfile {
  profile: Profile;
  demo: boolean;
  demoNote?: string;
}

// Best-effort extraction with no AI call, so uploading a CV still does
// something useful without an ANTHROPIC_API_KEY. Can't restructure freeform
// text into a summary/skills/experience breakdown without AI, so only the
// contact fields get filled — everything else stays empty rather than
// guessed. Flagged as `demo` so the UI can tell the user why.
function buildDemoProfileExtraction(rawText: string, note: string): ExtractedProfile {
  const email = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || "";
  const phone = rawText.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || "";
  const firstLine = rawText.split("\n").map((l) => l.trim()).find(Boolean) || "";
  const linkedin = rawText.match(/linkedin\.com\/in\/[\w-]+/i)?.[0] || "";

  return {
    profile: {
      name: firstLine,
      title: "",
      location: "",
      email,
      phone,
      links: linkedin ? [linkedin] : [],
      photo: "",
      cvFormat: "both",
      cvTemplate: DEFAULT_CV_TEMPLATE,
      resumeFile: null,
      summary: "",
      skills: [],
      experience: [],
      education: [],
      certifications: [],
      languages: [],
    },
    demo: true,
    demoNote: note,
  };
}

export async function extractStructuredResume(rawText: string): Promise<ExtractedProfile> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (process.env.DEMO_MODE === "true") {
    return buildDemoProfileExtraction(
      rawText,
      "Demo mode is on — only contact details (name, email, phone, LinkedIn) could be extracted automatically. Turn off DEMO_MODE to also extract Summary, Skills, Experience, and Education, or fill them in yourself below."
    );
  }
  if (!key) {
    return buildDemoProfileExtraction(
      rawText,
      "No ANTHROPIC_API_KEY configured — only contact details (name, email, phone, LinkedIn) could be extracted automatically. Add a key to also extract Summary, Skills, Experience, and Education, or fill them in yourself below."
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
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(rawText) }],
      }),
    });

    if (!r.ok) {
      console.error("extractStructuredResume: Claude API error", r.status, await r.text());
      return buildDemoProfileExtraction(rawText, "Claude is currently unavailable — only contact details could be extracted.");
    }

    const data = await r.json();
    const text: string = (data.content || [])
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const clean = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    return { profile: sanitizeProfile(JSON.parse(clean)), demo: false };
  } catch (err) {
    console.error("extractStructuredResume: extraction failed", err);
    return buildDemoProfileExtraction(rawText, "Live extraction failed — only contact details could be extracted.");
  }
}
