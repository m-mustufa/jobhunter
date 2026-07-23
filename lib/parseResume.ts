import { Profile } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const SYSTEM = `You turn raw, messily-extracted resume text into two things: a
structured contact profile, and a clean Master CV in Markdown. Preserve every
fact in the source text truthfully — do not invent employers, titles, dates,
skills, or achievements. Fix obvious extraction artifacts (broken line breaks,
stray page-number text) but do not add content that isn't there.

Return ONLY a valid JSON object. No markdown fences, no preamble.`;

function buildPrompt(rawText: string) {
  return `RAW RESUME TEXT (extracted from an uploaded file, formatting may be imperfect):
${rawText}

Return a single JSON object with exactly these keys:
{
  "profile": {
    "name": "<full name>",
    "title": "<current or most recent job title>",
    "location": "<city, country>",
    "email": "<email address, or empty string if none found>",
    "phone": "<phone number, or empty string if none found>",
    "links": ["<links found, e.g. LinkedIn, portfolio, GitHub — no duplicates>"]
  },
  "masterCV": "<the full CV rewritten in clean Markdown using this exact structure:\\n# Full Name\\nTitle — Location\\nemail · link · link\\n\\n## Summary\\n...\\n\\n## Core Skills\\ncomma, separated, list\\n\\n## Experience\\n\\n### Company — Role (dates)\\n- bullet\\n- bullet\\n\\n## Earlier\\n...brief earlier-career or education notes>"
}

Return only the JSON object.`;
}

export interface ParsedResume {
  profile: Profile;
  masterCV: string;
}

function toProfile(raw: any): Profile {
  return {
    name: String(raw?.name || ""),
    title: String(raw?.title || ""),
    location: String(raw?.location || ""),
    email: String(raw?.email || ""),
    phone: String(raw?.phone || ""),
    links: Array.isArray(raw?.links) ? raw.links.map(String).filter(Boolean) : [],
  };
}

// Best-effort extraction with no AI call, so uploading a CV still does
// something useful without an ANTHROPIC_API_KEY. Can't restructure the text
// like Claude can, so the Master CV is just the raw extracted text.
function buildDemoProfileExtraction(rawText: string): ParsedResume {
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
    },
    masterCV: rawText.trim(),
  };
}

export async function extractStructuredResume(rawText: string): Promise<ParsedResume> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (process.env.DEMO_MODE === "true" || !key) {
    return buildDemoProfileExtraction(rawText);
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
        messages: [{ role: "user", content: buildPrompt(rawText) }],
      }),
    });

    if (!r.ok) return buildDemoProfileExtraction(rawText);

    const data = await r.json();
    const text: string = (data.content || [])
      .map((b: any) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const clean = text.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(clean);

    return {
      profile: toProfile(parsed.profile),
      masterCV: String(parsed.masterCV || rawText),
    };
  } catch {
    return buildDemoProfileExtraction(rawText);
  }
}
