import { Profile } from "./types";

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
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    skills: Array.isArray(raw?.skills) ? raw.skills.map(String) : [],
    experience: Array.isArray(raw?.experience)
      ? raw.experience.map((e: any) => ({
          company: typeof e?.company === "string" ? e.company : "",
          role: typeof e?.role === "string" ? e.role : "",
          dates: typeof e?.dates === "string" ? e.dates : "",
          bullets: Array.isArray(e?.bullets) ? e.bullets.map(String) : [],
        }))
      : [],
    education: Array.isArray(raw?.education) ? raw.education.map(String) : [],
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
};
