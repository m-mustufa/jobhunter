import { Profile } from "./types";

const VALID_CV_FORMATS: Profile["cvFormat"][] = ["pdf", "docx", "both"];

export const IMMUTABLE_EXPERIENCE_COMPANY_NAMES = [
  "Data Managment Team - Technical Center",
  "Data Managment Team - Upper Zakum FD",
  "UZFDRTS - DM",
] as const;

const IMMUTABLE_COMPANY_ALIASES = [
  {
    canonical: IMMUTABLE_EXPERIENCE_COMPANY_NAMES[0],
    aliases: [
      "Data Managment Team - Technical Center",
      "Data Management Team - Technical Center",
    ],
  },
  {
    canonical: IMMUTABLE_EXPERIENCE_COMPANY_NAMES[1],
    aliases: [
      "Data Managment Team - Upper Zakum FD",
      "Data Management Team - Upper Zakum FD",
    ],
  },
  {
    canonical: IMMUTABLE_EXPERIENCE_COMPANY_NAMES[2],
    aliases: ["UZFDRTS - DM"],
  },
] as const;

function companyNameKey(value: string): string {
  return value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function canonicalizeExperienceCompanyName(value: unknown): string {
  const original = typeof value === "string" ? value.trim() : "";
  const key = companyNameKey(original);

  for (const entry of IMMUTABLE_COMPANY_ALIASES) {
    for (const alias of entry.aliases) {
      const aliasKey = companyNameKey(alias);
      const knownKeys = [
        aliasKey,
        `adnoc - ${aliasKey}`,
        `adnoc offshore - ${aliasKey}`,
      ];
      if (knownKeys.includes(key)) {
        return entry.canonical;
      }
    }
  }
  return original;
}

// Coerces an arbitrary value (an API response, or something read back from
// localStorage) into a fully-valid Profile — every array field guaranteed
// to be an array, every string field guaranteed to be a string. Needed
// because localStorage can hold data saved under an older, smaller Profile
// shape (e.g. from before Summary/Skills/Experience/Education existed);
// without this, missing fields come back `undefined` and crash anything
// that calls `.map()` on them.
export function sanitizeProfile(raw: any): Profile {
  return {
    name: typeof raw?.name === "string" ? raw.name : "",
    title: typeof raw?.title === "string" ? raw.title : "",
    location: typeof raw?.location === "string" ? raw.location : "",
    email: typeof raw?.email === "string" ? raw.email : "",
    phone: typeof raw?.phone === "string" ? raw.phone : "",
    links: Array.isArray(raw?.links) ? raw.links.map(String) : [],
    photo: typeof raw?.photo === "string" ? raw.photo : "",
    cvFormat: VALID_CV_FORMATS.includes(raw?.cvFormat) ? raw.cvFormat : "both",
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    skills: Array.isArray(raw?.skills) ? raw.skills.map(String) : [],
    experience: Array.isArray(raw?.experience)
      ? raw.experience.map((e: any) => ({
          company: canonicalizeExperienceCompanyName(e?.company),
          role: typeof e?.role === "string" ? e.role : "",
          dates: typeof e?.dates === "string" ? e.dates : "",
          bullets: Array.isArray(e?.bullets) ? e.bullets.map(String) : [],
        }))
      : [],
    education: Array.isArray(raw?.education) ? raw.education.map(String) : [],
    certifications: Array.isArray(raw?.certifications) ? raw.certifications.map(String) : [],
    languages: Array.isArray(raw?.languages) ? raw.languages.map(String) : [],
  };
}

// Seeds the Profile form so the demo works immediately. Replace with your
// own details — Master CV is generated from this (see lib/masterCV.ts), and
// this is what fills the header of every generated CV/cover letter.
export const DEFAULT_PROFILE: Profile = {
  name: "Muhammad Mustafa",
  title: "Senior Full-Stack Engineer",
  location: "Karachi, Pakistan (UTC+5)",
  email: "mustufa50@gmail.com",
  phone: "",
  links: ["mustcode.netlify.app", "linkedin.com/in/muhammad-mustafa-16477a99"],
  photo: "",
  cvFormat: "both",
  summary:
    "Senior full-stack engineer with 10+ years of experience building and shipping " +
    "production SaaS. Comfortable owning features end to end — from database design " +
    "to polished UI — across large multi-tenant platforms and solo-founded products.",
  skills: [
    "Angular (v8–v19)",
    "React",
    "Next.js",
    "Node.js",
    "TypeScript",
    "JavaScript",
    "MongoDB",
    "PostgreSQL",
    "Supabase",
    "REST APIs",
    "Stripe",
    "Clerk",
    "TailwindCSS",
    "OpenAI/Claude APIs",
  ],
  experience: [
    {
      company: "AutoLeap",
      role: "Senior Full-Stack Engineer",
      dates: "2021–present",
      bullets: [
        "Canadian SaaS platform serving 5,000+ auto-repair shops across North America.",
        "2,800+ commits across core modules: Workboard 2.0, Repair Orders, Purchase Orders.",
        "Built and maintained performant, user-friendly UIs used daily by thousands of shops.",
        "Designed and integrated scalable backend logic and APIs on a large multi-tenant system.",
      ],
    },
    {
      company: "CultureAI",
      role: "Founding Engineer (solo)",
      dates: "",
      bullets: [
        "Live multi-tenant, AI-powered employee-engagement SaaS, built and shipped solo.",
        "Owned the full stack: auth, multi-tenancy, data model, AI features, and UI.",
        "Integrated LLM APIs into product workflows end to end.",
      ],
    },
    {
      company: "StartStorez",
      role: "Co-founder",
      dates: "2021–present",
      bullets: [
        "Shopify store-building service; delivered 2,000+ stores.",
        "Built repeatable delivery processes and client-facing web work at volume.",
      ],
    },
  ],
  education: ["Started as a UI intern in 2014; grew into senior full-stack work over a decade."],
  certifications: [],
  languages: ["English (Fluent)"],
};
