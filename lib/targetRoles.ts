// The seniority/functional titles this agent hunts for, per the agent spec
// plus client-approved additions (executive/C-suite, director tier, and
// previously-uncovered functions: Legal, Marketing, Audit/Risk,
// Sustainability/ESG, Investment/Treasury).
export const TARGET_ROLE_TITLES = [
  "Vice President",
  "Assistant Vice President",
  "General Manager",
  "Deputy General Manager",
  "Business Unit Head",
  "Division Head",
  "Department Head",
  "Senior Manager",
  "Department Manager",
  "Area Manager",
  "Senior Project Manager",
  "Project Director",
  "Engineering Manager",
  "Operations Manager",
  "Commercial Manager",
  "Finance Manager",
  "HR Manager",
  "IT Manager",
  "Data Management Manager",
  "Quality Manager",
  "QA-QC Manager",
  "HSE Manager",
  "Supply Chain Manager",
  "Procurement Manager",
  "Contracts Manager",
  "Business Development Manager",
  "Strategy and Transformation Manager",
  "Governance, Risk and Compliance Manager",
  "Team Leader",
  "Section Head",
  "Lead",
  // --- Executive / C-suite ---
  "Managing Director",
  "Executive Director",
  "Chief Executive Officer",
  "Chief Operating Officer",
  "Chief Financial Officer",
  "Chief Technology Officer",
  "Chief Information Officer",
  "Chief Human Resources Officer",
  "Chief Commercial Officer",
  "Chief Strategy Officer",
  "Chief Risk Officer",
  "Chief Compliance Officer",
  "Chief Marketing Officer",
  "Country Manager",
  "Country Head",
  "Regional Director",
  "Regional Manager",
  // --- Director tier ---
  "Senior Director",
  "Portfolio Director",
  "Director",
  // --- Legal ---
  "General Counsel",
  "Legal Manager",
  "Legal Counsel",
  // --- Marketing & Communications ---
  "Marketing Manager",
  "Communications Manager",
  // --- Audit, Risk & Compliance ---
  "Internal Audit Manager",
  "Risk Manager",
  "Compliance Manager",
  // --- Sustainability / ESG ---
  "Sustainability Manager",
  "ESG Manager",
  // --- Investment & Treasury ---
  "Investment Manager",
  "Treasury Manager",
  "Portfolio Manager",
  // --- Other senior functions ---
  "Category Manager",
  "Facilities Manager",
  "Program Manager",
];

// Functional domains the target titles fall into, for the Field filter.
export const FUNCTIONAL_DOMAINS: { domain: string; titles: string[] }[] = [
  {
    domain: "Executive & Leadership",
    titles: [
      "Vice President",
      "Assistant Vice President",
      "General Manager",
      "Deputy General Manager",
      "Business Unit Head",
      "Division Head",
      "Department Head",
      "Managing Director",
      "Executive Director",
      "Chief Executive Officer",
      "Chief Operating Officer",
      "Chief Financial Officer",
      "Chief Technology Officer",
      "Chief Information Officer",
      "Chief Human Resources Officer",
      "Chief Commercial Officer",
      "Chief Strategy Officer",
      "Chief Risk Officer",
      "Chief Compliance Officer",
      "Chief Marketing Officer",
      "Country Manager",
      "Country Head",
      "Regional Director",
      "Regional Manager",
      "Senior Director",
      "Portfolio Director",
      "Director",
    ],
  },
  {
    domain: "Management & Team Leadership",
    titles: ["Senior Manager", "Department Manager", "Area Manager", "Team Leader", "Section Head", "Lead"],
  },
  {
    domain: "Project & Engineering",
    titles: ["Senior Project Manager", "Project Director", "Engineering Manager", "Program Manager"],
  },
  { domain: "Operations", titles: ["Operations Manager", "Facilities Manager", "Category Manager"] },
  {
    domain: "Commercial & Finance",
    titles: ["Commercial Manager", "Finance Manager", "Investment Manager", "Treasury Manager", "Portfolio Manager"],
  },
  { domain: "HR", titles: ["HR Manager"] },
  { domain: "IT & Data", titles: ["IT Manager", "Data Management Manager"] },
  { domain: "Quality & HSE", titles: ["Quality Manager", "QA-QC Manager", "HSE Manager"] },
  {
    domain: "Supply Chain & Procurement",
    titles: ["Supply Chain Manager", "Procurement Manager", "Contracts Manager"],
  },
  {
    domain: "Business Development & Strategy",
    titles: [
      "Business Development Manager",
      "Strategy and Transformation Manager",
      "Governance, Risk and Compliance Manager",
      "Internal Audit Manager",
      "Risk Manager",
      "Compliance Manager",
      "Sustainability Manager",
      "ESG Manager",
    ],
  },
  {
    domain: "Legal & Governance",
    titles: ["General Counsel", "Legal Manager", "Legal Counsel"],
  },
  {
    domain: "Marketing & Communications",
    titles: ["Marketing Manager", "Communications Manager"],
  },
];

// All target titles, longest first, so "Assistant Vice President" is tried
// before the "Vice President" substring it contains (and "Director" is
// tried last of all, since it's a substring of most of the new C-suite/
// director titles above).
const TITLES_BY_LENGTH = [...TARGET_ROLE_TITLES].sort((a, b) => b.length - a.length);

const DOMAIN_BY_TITLE = new Map<string, string>();
for (const { domain, titles } of FUNCTIONAL_DOMAINS) {
  for (const title of titles) DOMAIN_BY_TITLE.set(title, domain);
}

// Tags a live/sample job posting title with the canonical target title it
// best matches, for the Title and Field filters.
export function matchTargetTitle(postingTitle: string): string | null {
  const haystack = postingTitle.toLowerCase();
  for (const title of TITLES_BY_LENGTH) {
    if (haystack.includes(title.toLowerCase())) return title;
  }
  return null;
}

export function matchFunctionalDomain(postingTitle: string): string | null {
  const title = matchTargetTitle(postingTitle);
  return title ? DOMAIN_BY_TITLE.get(title) || null : null;
}

// Legacy OR-query groups retained for the disabled public LinkedIn crawler
// and easy rollback. Hirebase receives TARGET_ROLE_TITLES directly.
export const QUERY_GROUPS = [
  "Vice President OR Assistant Vice President OR General Manager OR Deputy General Manager Abu Dhabi",
  "Business Unit Head OR Division Head OR Department Head Abu Dhabi",
  "Senior Manager OR Department Manager OR Area Manager Abu Dhabi",
  "Project Director OR Senior Project Manager OR Engineering Manager Abu Dhabi",
  "Operations Manager OR Commercial Manager OR Finance Manager OR HR Manager Abu Dhabi",
  "IT Manager OR Data Management Manager OR Quality Manager OR QA-QC Manager OR HSE Manager Abu Dhabi",
  "Supply Chain Manager OR Procurement Manager OR Contracts Manager Abu Dhabi",
  "Business Development Manager OR Strategy and Transformation Manager OR Governance Risk and Compliance Manager Abu Dhabi",
  "Team Leader OR Section Head OR Lead Abu Dhabi",
  // --- New: Executive / C-suite / Director tier ---
  "Managing Director OR Executive Director OR Director OR Senior Director OR Country Manager OR Country Head Abu Dhabi",
  "Regional Director OR Regional Manager OR Portfolio Director OR Chief Executive Officer OR Chief Operating Officer OR Chief Financial Officer Abu Dhabi",
  "Chief Technology Officer OR Chief Information Officer OR Chief Human Resources Officer OR Chief Commercial Officer OR Chief Strategy Officer Abu Dhabi",
  "Chief Risk Officer OR Chief Compliance Officer OR Chief Marketing Officer OR General Counsel OR Legal Manager OR Legal Counsel Abu Dhabi",
  // --- New: Marketing, Audit/Risk, Sustainability, Investment, Other ---
  "Marketing Manager OR Communications Manager OR Internal Audit Manager OR Risk Manager OR Compliance Manager Abu Dhabi",
  "Sustainability Manager OR ESG Manager OR Investment Manager OR Treasury Manager OR Portfolio Manager Abu Dhabi",
  "Category Manager OR Facilities Manager OR Program Manager Abu Dhabi",
];
