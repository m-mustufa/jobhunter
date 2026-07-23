// The seniority/functional titles this agent hunts for, per the agent spec.
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
    ],
  },
  {
    domain: "Management & Team Leadership",
    titles: ["Senior Manager", "Department Manager", "Area Manager", "Team Leader", "Section Head", "Lead"],
  },
  {
    domain: "Project & Engineering",
    titles: ["Senior Project Manager", "Project Director", "Engineering Manager"],
  },
  { domain: "Operations", titles: ["Operations Manager"] },
  { domain: "Commercial & Finance", titles: ["Commercial Manager", "Finance Manager"] },
  { domain: "HR", titles: ["HR Manager"] },
  { domain: "IT & Data", titles: ["IT Manager", "Data Management Manager"] },
  { domain: "Quality & HSE", titles: ["Quality Manager", "QA-QC Manager", "HSE Manager"] },
  {
    domain: "Supply Chain & Procurement",
    titles: ["Supply Chain Manager", "Procurement Manager", "Contracts Manager"],
  },
  {
    domain: "Business Development & Strategy",
    titles: ["Business Development Manager", "Strategy and Transformation Manager", "Governance, Risk and Compliance Manager"],
  },
];

// All target titles, longest first, so "Assistant Vice President" is tried
// before the "Vice President" substring it contains.
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

// Related titles grouped into OR-queries so one search click costs a
// handful of JSearch calls instead of one per title.
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
];
