import { Job } from "./types";

// Used only when JSEARCH_API_KEY is not set, so the demo still runs.
// Realistic UAE full-stack postings; the real API replaces these live.
export const SAMPLE_JOBS: Job[] = [
  {
    id: "sample-1",
    title: "Senior Full-Stack Engineer (React / Node.js)",
    company: "Nomad Technologies",
    location: "Abu Dhabi, UAE",
    salary: "AED 25,000 – 32,000 / month",
    description:
      "We're hiring a senior full-stack engineer to build a multi-tenant SaaS platform. Strong React and Next.js on the front end, Node.js and PostgreSQL on the back end. You'll own features end to end, design scalable APIs, and care about performance and clean UI. Experience shipping production SaaS and working with cloud hosting required. Visa sponsorship available for the right candidate.",
    applyLink: "https://example.com/apply/1",
    source: "LinkedIn (via Google for Jobs)",
    postedAt: "2 hours ago",
  },
  {
    id: "sample-2",
    title: "Frontend Engineer — Angular",
    company: "Gulf Digital Labs",
    location: "Abu Dhabi, UAE",
    salary: "AED 20,000 – 26,000 / month",
    description:
      "Frontend engineer with deep Angular experience (v12+) to work on a large enterprise dashboard. TypeScript, RxJS, component architecture, and a strong eye for UX. You'll collaborate with backend and design to ship reliable, accessible interfaces. Bonus: TailwindCSS and design-system experience.",
    applyLink: "https://example.com/apply/2",
    source: "Indeed (via Google for Jobs)",
    postedAt: "5 hours ago",
  },
  {
    id: "sample-3",
    title: "Full-Stack Developer — SaaS Product",
    company: "Meridian Software",
    location: "Dubai, UAE",
    salary: null,
    description:
      "Join a fast-growing product team building a B2B SaaS product. Next.js, Node.js, and a Postgres/Supabase stack. Comfort with Stripe billing, auth (Clerk or similar), and multi-tenant data models is a big plus. We value engineers who can move fast and still ship quality.",
    applyLink: "https://example.com/apply/3",
    source: "Company career page (via Google for Jobs)",
    postedAt: "1 day ago",
  },
  {
    id: "sample-4",
    title: "Backend Engineer (Node.js / PostgreSQL)",
    company: "Falcon Fintech",
    location: "Abu Dhabi, UAE",
    salary: "AED 22,000 – 30,000 / month",
    description:
      "Backend-focused engineer to design and scale APIs for a fintech platform. Node.js, TypeScript, PostgreSQL, REST, and event-driven patterns. Security-minded, comfortable with cloud infrastructure and CI/CD. You'll partner with a small full-stack team and have real ownership.",
    applyLink: "https://example.com/apply/4",
    source: "Glassdoor (via Google for Jobs)",
    postedAt: "1 day ago",
  },
];
