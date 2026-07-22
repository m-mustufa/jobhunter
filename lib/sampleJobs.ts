import { Job } from "./types";

// Used only when JSEARCH_API_KEY is not set, so the demo still runs.
// Spans the target role list and all four match tiers against the sample
// software-engineer master CV; the real API replaces these live.
export const SAMPLE_JOBS: Job[] = [
  {
    id: "sample-1",
    title: "Engineering Manager — SaaS Platform",
    company: "Nomad Technologies",
    location: "Abu Dhabi, UAE",
    salary: "AED 35,000 – 45,000 / month",
    description:
      "We're hiring an Engineering Manager to lead a full-stack team building a multi-tenant SaaS platform. Strong hands-on background in React/Next.js and Node.js/PostgreSQL required, plus experience owning features end to end, designing scalable APIs, and mentoring engineers. Experience shipping production SaaS is essential. Visa sponsorship available for the right candidate.",
    applyLink: "https://example.com/apply/1",
    source: "LinkedIn (via Google for Jobs)",
    postedAt: "2 hours ago",
  },
  {
    id: "sample-2",
    title: "IT Manager",
    company: "Gulf Digital Holdings",
    location: "Abu Dhabi, UAE",
    salary: "AED 30,000 – 38,000 / month",
    description:
      "IT Manager to oversee application development and platform reliability for an enterprise group. Background in full-stack development (TypeScript, Node.js, cloud infrastructure), API design, and team leadership. You'll set technical direction, manage vendor relationships, and support product teams building internal SaaS tools.",
    applyLink: "https://example.com/apply/2",
    source: "Indeed (via Google for Jobs)",
    postedAt: "5 hours ago",
  },
  {
    id: "sample-3",
    title: "Data Management Manager",
    company: "Meridian Holding",
    location: "Abu Dhabi, UAE",
    salary: null,
    description:
      "Lead the data management function for a diversified holding company: data architecture, governance, and the systems that support it. Experience with PostgreSQL/Supabase-style data platforms, REST APIs, and translating business requirements into technical data models preferred. Some team leadership experience required.",
    applyLink: "https://example.com/apply/3",
    source: "Company career page (via Google for Jobs)",
    postedAt: "1 day ago",
  },
  {
    id: "sample-4",
    title: "Department Manager — Digital Products",
    company: "Falcon Fintech",
    location: "Abu Dhabi, UAE",
    salary: "AED 32,000 – 40,000 / month",
    description:
      "Own the digital products department for a fintech platform: roadmap, delivery, and a small team of engineers and designers. Background in software product delivery, stakeholder management, and enough technical depth to review architecture decisions (Node.js/TypeScript stack) is a strong plus.",
    applyLink: "https://example.com/apply/4",
    source: "Glassdoor (via Google for Jobs)",
    postedAt: "1 day ago",
  },
  {
    id: "sample-5",
    title: "Business Unit Head — Technology Services",
    company: "Alpha Holding Group",
    location: "Abu Dhabi, UAE",
    salary: "AED 45,000 – 60,000 / month",
    description:
      "Lead a technology services business unit within a large conglomerate: P&L ownership, client relationships, and delivery oversight across multiple product teams. Ideal candidate has led engineering or product organizations previously and can operate at a senior-management level across commercial and technical stakeholders.",
    applyLink: "https://example.com/apply/5",
    source: "LinkedIn (via Google for Jobs)",
    postedAt: "2 days ago",
  },
  {
    id: "sample-6",
    title: "Senior Manager — Strategy and Transformation",
    company: "ADIC Portfolio Company",
    location: "Abu Dhabi, UAE",
    salary: null,
    description:
      "Drive digital transformation initiatives across a portfolio company: process redesign, technology enablement, and change management. Prior consulting or in-house transformation experience required; software delivery background is a plus but not central to the role.",
    applyLink: "https://example.com/apply/6",
    source: "Company career page (via Google for Jobs)",
    postedAt: "2 days ago",
  },
  {
    id: "sample-7",
    title: "Operations Manager — Logistics",
    company: "AD Ports Group",
    location: "Abu Dhabi, UAE",
    salary: "AED 28,000 – 34,000 / month",
    description:
      "Manage day-to-day operations across a logistics and freight terminal: staffing, KPIs, safety compliance, and vendor coordination. Requires prior operations management experience in ports, logistics, or a similar industrial environment.",
    applyLink: "https://example.com/apply/7",
    source: "Indeed (via Google for Jobs)",
    postedAt: "3 days ago",
  },
  {
    id: "sample-8",
    title: "HSE Manager",
    company: "Emsteel",
    location: "Abu Dhabi, UAE",
    salary: "AED 26,000 – 32,000 / month",
    description:
      "Lead health, safety and environment programs across a heavy manufacturing site. NEBOSH/IOSH certification and prior HSE management experience in steel, construction, or industrial manufacturing required. Responsible for incident investigation, compliance audits, and safety training programs.",
    applyLink: "https://example.com/apply/8",
    source: "Company career page (via Google for Jobs)",
    postedAt: "3 days ago",
  },
  {
    id: "sample-9",
    title: "Procurement Manager",
    company: "Trojan Holding",
    location: "Abu Dhabi, UAE",
    salary: "AED 24,000 – 30,000 / month",
    description:
      "Manage procurement and supplier contracts for a large construction and contracting group. Requires deep experience in construction procurement, vendor negotiation, and contract administration. Engineering or QS background a plus.",
    applyLink: "https://example.com/apply/9",
    source: "Glassdoor (via Google for Jobs)",
    postedAt: "4 days ago",
  },
  {
    id: "sample-10",
    title: "Team Leader — Application Support",
    company: "First Abu Dhabi Bank (FAB)",
    location: "Abu Dhabi, UAE",
    salary: "AED 22,000 – 27,000 / month",
    description:
      "Lead a small application-support team for internal banking platforms: triage production issues, coordinate with engineering, and manage on-call rotations. Hands-on technical background (SQL, REST APIs, ticketing systems) plus 1-2 years of people leadership preferred.",
    applyLink: "https://example.com/apply/10",
    source: "LinkedIn (via Google for Jobs)",
    postedAt: "4 days ago",
  },
];
