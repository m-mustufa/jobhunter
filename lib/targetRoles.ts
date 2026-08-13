// The seniority/functional titles this agent hunts for, per the agent spec
// plus client-approved additions (executive/C-suite, director tier, and
// previously-uncovered functions: Legal, Marketing, Audit/Risk,
// Sustainability/ESG, Investment/Treasury).
export const TARGET_ROLE_TITLES = [
  "President",
  "Executive Vice President",
  "Senior Vice President",
  "Associate Vice President",
  "Vice President",
  "Assistant Vice President",
  "General Manager",
  "Assistant General Manager",
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
  "Chief Product Officer",
  "Chief People Officer",
  "Chief Procurement Officer",
  "Chief Administrative Officer",
  "Chief Data Officer",
  "Chief Digital Officer",
  "Chief Information Security Officer",
  "Chief Legal Officer",
  "Chief Investment Officer",
  "Chief Security Officer",
  "Chief Sustainability Officer",
  "Chief Transformation Officer",
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
  "Deputy Director",
  "Associate Director",
  "Assistant Director",
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
  // --- Broad managerial equivalents and industry-specific leadership ---
  "Manager",
  "Head",
  "Principal",
  "Supervisor",
  "Superintendent",
  "Controller",
  "Senior Specialist",
  "Senior Advisor",
  "Senior Counsel",
  "Partner",
  "Technical Authority",
  "Product Owner",
  "Director General",
  "Secretary General",
  "Undersecretary",
  "Governor",
  "Commissioner",
  "Vice Chancellor",
  "Provost",
  "Dean",
  "Commander",
  "Subject Matter Expert",
  "Distinguished Engineer",
  "Technical Fellow",
  "Management Consultant",
  "Enterprise Architect",
  "Solution Architect",
  "Solutions Architect",
];

// Providers differ in how they parse titles. These functional stems generate
// common "X Manager", "Head of X", "X Director", and "X Lead" variants so
// the upstream query does not depend on one exact word order or spelling.
const MANAGERIAL_FUNCTIONS = [
  "Administration",
  "Accounting",
  "Academic Affairs",
  "Admissions",
  "AI",
  "Aircraft Maintenance",
  "Airport Operations",
  "Air Traffic Services",
  "Analytics",
  "Application Development",
  "Architecture",
  "Artificial Intelligence",
  "Asset Management",
  "Asset Integrity",
  "Actuarial",
  "Automation",
  "Aviation Safety",
  "Base Operations",
  "BIM",
  "Board Secretariat",
  "Business Excellence",
  "Business Development",
  "Campus",
  "Cargo",
  "Category Management",
  "Change Management",
  "Claims",
  "Clinical Operations",
  "Cloud",
  "Commercial",
  "Commissioning",
  "Communications",
  "Compliance",
  "Construction",
  "Contracts",
  "Corporate Banking",
  "Corporate Affairs",
  "Corporate Communications",
  "Corporate Finance",
  "Corporate Governance",
  "Corporate Secretariat",
  "Community Management",
  "Cost Control",
  "Credit",
  "Crisis Management",
  "Customs",
  "Customer Experience",
  "Cyber Security",
  "Cybersecurity",
  "Data",
  "Data Analytics",
  "Data Science",
  "Data Governance",
  "Data Management",
  "Design",
  "Development",
  "DevOps",
  "Digital",
  "Digital Transformation",
  "Distribution",
  "Drilling",
  "Economic Development",
  "Education",
  "EHS",
  "Emergency Management",
  "Energy Transition",
  "Engineering",
  "Enterprise Applications",
  "Enterprise Architecture",
  "ERP",
  "ESG",
  "Estimation",
  "Executive Office",
  "Facilities",
  "Finance",
  "Financial Planning and Analysis",
  "Financial Reporting",
  "Fleet",
  "Flight Operations",
  "Freight",
  "Geoscience",
  "Government Affairs",
  "Government Relations",
  "Governance",
  "Governance Risk and Compliance",
  "Ground Operations",
  "Health Safety and Environment",
  "Hospital Administration",
  "HSSE",
  "HSE",
  "Human Capital",
  "Human Resources",
  "Infrastructure Delivery",
  "Information Security",
  "Information Technology",
  "Infrastructure",
  "Inspection",
  "Institutional Excellence",
  "Insurance",
  "Internal Audit",
  "International Cooperation",
  "Investment",
  "Investor Relations",
  "IT Service Delivery",
  "Laboratory",
  "Last Mile",
  "Legal",
  "Licensing",
  "Logistics",
  "Machine Learning",
  "Maintenance",
  "Marine",
  "Marketing",
  "Mergers and Acquisitions",
  "MEP",
  "MRO",
  "Network",
  "Nursing",
  "Offshore",
  "Operations",
  "Organizational Development",
  "OT Security",
  "Patient Safety",
  "Performance Management",
  "Petroleum Engineering",
  "Pharmacy",
  "Planning",
  "Planning and Scheduling",
  "Platform Engineering",
  "Policy",
  "PMO",
  "Port Operations",
  "Portfolio",
  "Private Banking",
  "Process Safety",
  "Procurement",
  "Production",
  "Product",
  "Program",
  "Programme",
  "Project",
  "Project Controls",
  "Project Delivery",
  "Property Management",
  "Public Affairs",
  "QHSE",
  "Quality",
  "QA QC",
  "Quantity Surveying",
  "Radiology",
  "Real Estate Development",
  "Regulatory Affairs",
  "Reliability",
  "Research",
  "Reservoir Engineering",
  "Retail Banking",
  "Risk",
  "Sales",
  "School Operations",
  "Security",
  "Security Operations",
  "Shared Services",
  "Shipping",
  "Shutdown",
  "Software Engineering",
  "Station",
  "Strategy",
  "Strategic Planning",
  "Subsurface",
  "Supply Chain",
  "Sustainability",
  "Talent Acquisition",
  "Tax",
  "Technical Services",
  "Technology",
  "Telecommunications",
  "Tendering",
  "Transport",
  "Transformation",
  "Treasury",
  "Turnaround",
  "Underwriting",
  "Vendor Management",
  "Warehouse",
  "Wealth Management",
  "Well Integrity",
  "Well Services",
] as const;

const LEADERSHIP_SEARCH_TITLES = [
  "Chairman",
  "Chairperson",
  "Executive Chairman",
  "Director General",
  "Deputy Director General",
  "Secretary General",
  "Deputy Secretary General",
  "Undersecretary",
  "Assistant Undersecretary",
  "Governor",
  "Deputy Governor",
  "Commissioner",
  "Deputy Commissioner",
  "Vice Chancellor",
  "Deputy Vice Chancellor",
  "Provost",
  "Dean",
  "Associate Dean",
  "Assistant Dean",
  "Department Chair",
  "Rector",
  "Registrar",
  "Bursar",
  "Headteacher",
  "School Director",
  "Commander",
  "Deputy Commander",
  "Managing Partner",
  "Associate Partner",
  "Practice Leader",
  "Practice Head",
  "Group Head",
  "Function Head",
  "Functional Head",
  "Unit Head",
  "Branch Head",
  "Cluster Head",
  "Office Head",
  "Head of Department",
  "Head of Function",
  "Head of Operations",
  "Head of Technology",
  "Head of Engineering",
  "Head of Data",
  "Head of Quality",
  "Technical Director",
  "Technical Services Director",
  "Technical Manager",
  "Technical Lead",
  "Technical Authority",
  "Chief Engineer",
  "Principal Engineer",
  "Lead Engineer",
  "Distinguished Engineer",
  "Technical Fellow",
  "Subject Matter Expert",
  "Chief Medical Officer",
  "Medical Director",
  "Clinical Director",
  "Nursing Director",
  "Director of Nursing",
  "Nurse Manager",
  "Plant Manager",
  "Terminal Manager",
  "Field Manager",
  "Asset Manager",
  "Asset Director",
  "Asset Leader",
  "Drilling Superintendent",
  "Production Superintendent",
  "Operations Superintendent",
  "Maintenance Superintendent",
  "Chief Specialist",
  "Principal Specialist",
  "Lead Specialist",
  "Senior Specialist",
  "Chief Advisor",
  "Principal Advisor",
  "Lead Advisor",
  "Senior Advisor",
  "Management Consultant",
  "Managing Consultant",
  "Principal Consultant",
  "Senior Consultant",
  "Chief Architect",
  "Principal Architect",
  "Lead Architect",
  "Enterprise Architect",
  "Solution Architect",
  "Solutions Architect",
  "Chief Legal Officer",
  "Chief Data Officer",
  "Chief Digital Officer",
  "Chief Security Officer",
  "Chief Sustainability Officer",
  "Chief Investment Officer",
  "Chief Transformation Officer",
  "Chief Administrative Officer",
  "Corporate Secretary",
  "Company Secretary",
  "Financial Controller",
  "Corporate Controller",
  "Project Controller",
  "Program Director",
  "Programme Director",
  "Project Controls Director",
  "Commercial Director",
  "Contracts Director",
  "Planning Director",
  "Development Director",
  "Chief Accountant",
  "Product Owner",
  "Program Owner",
  "Programme Owner",
  "Portfolio Owner",
  "Senior Officer",
  "Principal Officer",
] as const;

function uniqueTitles(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const PROVIDER_SEARCH_TITLES = uniqueTitles([
  ...TARGET_ROLE_TITLES,
  ...LEADERSHIP_SEARCH_TITLES,
  ...MANAGERIAL_FUNCTIONS.flatMap((domain) => [
    `${domain} Manager`,
    `${domain} Director`,
    `${domain} Head`,
    `Head of ${domain}`,
    `${domain} Lead`,
  ]),
]);

// TheirStack supports case-insensitive regex title filters. The same patterns
// are also used locally, preventing the provider from returning a useful alias
// that our post-filter would accidentally discard.
export const PRIORITY_MANAGERIAL_TITLE_PATTERN_SOURCES = [
  String.raw`\b(?:ceo|coo|cfo|cto|cio|chro|cmo|cco|cso|cro|clo|cdo|cpo|cao|ciso|cgo)\b`,
  String.raw`\b(?:president|vice[\s-]+president|vp|avp|svp|evp|gm|dgm|agm|hod|chief|chairman|chairperson|general\s+manager)\b`,
  String.raw`\b(?:director|head|headteacher|principal|undersecretary|governor|commissioner|provost|dean|chancellor|rector|registrar|bursar|commander|chair)\b`,
  String.raw`\b(?:senior|sr\.?|principal|lead|chief|head|managing|executive|regional|country|group|portfolio|project|program(?:me)?|department|division|function|unit)\s+(?:manager|mgr\.?|director|head|lead|specialist|officer|advisor|consultant|architect|engineer)\b`,
  String.raw`\b(?:engineering|operations|commercial|finance|financial|human\s+resources|hr|information\s+technology|it|data|quality|qa[\s/-]*qc|hse|hsse|qhse|supply\s+chain|procurement|contracts?|business\s+development|strategy|transformation|governance|risk|compliance|audit|sustainability|esg|investment|treasury|portfolio|facilities|technical|asset|drilling|subsurface|reservoir|petroleum|production|maintenance|construction|real\s+estate|policy|regulatory|government|public\s+affairs|corporate\s+affairs|legal|security|cybersecurity)\s+(?:manager|mgr\.?|director|head|lead)\b`,
  String.raw`\b(?:technical\s+authority|technical\s+fellow|distinguished\s+engineer|subject\s+matter\s+expert|sme|company\s+secretary|corporate\s+secretary|secretary\s+general|management\s+consultant|enterprise\s+architect|solutions?\s+architect)\b`,
];

export const BROAD_MANAGERIAL_TITLE_PATTERN_SOURCES = [
  String.raw`\b(?:manager|mgr\.?|lead|leader|supervisor|superintendent|controller|partner|counsel)\b`,
  String.raw`\b(?:product\s+owner|program(?:me)?\s+owner|portfolio\s+owner)\b`,
];

export const MANAGERIAL_TITLE_PATTERN_SOURCES = [
  ...PRIORITY_MANAGERIAL_TITLE_PATTERN_SOURCES,
  ...BROAD_MANAGERIAL_TITLE_PATTERN_SOURCES,
];

export const NON_MANAGERIAL_TITLE_PATTERN_SOURCES = [
  String.raw`\bassistant\s+to\s+(?:the\s+)?(?:manager|director|head|president|chief)\b`,
];

// Functional domains the target titles fall into, for the Field filter.
export const FUNCTIONAL_DOMAINS: { domain: string; titles: string[] }[] = [
  {
    domain: "Executive & Leadership",
    titles: [
      "President",
      "Executive Vice President",
      "Senior Vice President",
      "Associate Vice President",
      "Vice President",
      "Assistant Vice President",
      "General Manager",
      "Assistant General Manager",
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
      "Chief Product Officer",
      "Chief People Officer",
      "Chief Procurement Officer",
      "Chief Administrative Officer",
      "Chief Data Officer",
      "Chief Digital Officer",
      "Chief Information Security Officer",
      "Chief Legal Officer",
      "Chief Investment Officer",
      "Chief Security Officer",
      "Chief Sustainability Officer",
      "Chief Transformation Officer",
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
      "Deputy Director",
      "Associate Director",
      "Assistant Director",
      "Director",
      "Director General",
      "Secretary General",
      "Undersecretary",
      "Governor",
      "Commissioner",
      "Vice Chancellor",
      "Provost",
      "Dean",
      "Commander",
    ],
  },
  {
    domain: "Management & Team Leadership",
    titles: [
      "Senior Manager",
      "Department Manager",
      "Area Manager",
      "Manager",
      "Head",
      "Team Leader",
      "Section Head",
      "Lead",
      "Principal",
      "Supervisor",
      "Superintendent",
      "Senior Specialist",
      "Senior Advisor",
      "Partner",
      "Subject Matter Expert",
      "Management Consultant",
    ],
  },
  {
    domain: "Project & Engineering",
    titles: [
      "Senior Project Manager",
      "Project Director",
      "Engineering Manager",
      "Program Manager",
      "Technical Authority",
      "Product Owner",
      "Distinguished Engineer",
      "Technical Fellow",
      "Enterprise Architect",
      "Solution Architect",
      "Solutions Architect",
    ],
  },
  { domain: "Operations", titles: ["Operations Manager", "Facilities Manager", "Category Manager"] },
  {
    domain: "Commercial & Finance",
    titles: ["Commercial Manager", "Finance Manager", "Investment Manager", "Treasury Manager", "Portfolio Manager", "Controller"],
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
    titles: ["General Counsel", "Legal Manager", "Legal Counsel", "Senior Counsel"],
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

function normalizePostingTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTitlePhrase(postingTitle: string, targetTitle: string): boolean {
  const haystack = ` ${normalizePostingTitle(postingTitle)} `;
  const needle = ` ${normalizePostingTitle(targetTitle)} `;
  return haystack.includes(needle);
}

const MANAGERIAL_TITLE_PATTERNS = MANAGERIAL_TITLE_PATTERN_SOURCES.map(
  (source) => new RegExp(source, "i")
);
const NON_MANAGERIAL_TITLE_PATTERNS = NON_MANAGERIAL_TITLE_PATTERN_SOURCES.map(
  (source) => new RegExp(source, "i")
);

const ABBREVIATION_TITLES: Array<[RegExp, string]> = [
  [/\bceo\b/i, "Chief Executive Officer"],
  [/\bcoo\b/i, "Chief Operating Officer"],
  [/\bcfo\b/i, "Chief Financial Officer"],
  [/\bcto\b/i, "Chief Technology Officer"],
  [/\bcio\b/i, "Chief Information Officer"],
  [/\bchro\b/i, "Chief Human Resources Officer"],
  [/\bcmo\b/i, "Chief Marketing Officer"],
  [/\bcpo\b/i, "Chief Product Officer"],
  [/\bcao\b/i, "Chief Administrative Officer"],
  [/\bciso\b/i, "Chief Information Security Officer"],
  [/\bclo\b/i, "Chief Legal Officer"],
  [/\bcdo\b/i, "Chief Data Officer"],
  [/\bcco\b/i, "Chief Commercial Officer"],
  [/\bcso\b/i, "Chief Strategy Officer"],
  [/\bcro\b/i, "Chief Risk Officer"],
  [/\bdgm\b/i, "Deputy General Manager"],
  [/\bagm\b/i, "Assistant General Manager"],
  [/\bgm\b/i, "General Manager"],
  [/\bhod\b/i, "Department Head"],
  [/\bsme\b/i, "Subject Matter Expert"],
  [/\bevp\b/i, "Executive Vice President"],
  [/\bsvp\b/i, "Senior Vice President"],
  [/\bavp\b/i, "Assistant Vice President"],
  [/\bvp\b/i, "Vice President"],
];

// Tags a live/sample job posting title with the canonical target title it
// best matches, for the Title and Field filters.
export function matchTargetTitle(postingTitle: string): string | null {
  if (NON_MANAGERIAL_TITLE_PATTERNS.some((pattern) => pattern.test(postingTitle))) return null;

  for (const [pattern, canonicalTitle] of ABBREVIATION_TITLES) {
    if (pattern.test(postingTitle)) return canonicalTitle;
  }

  for (const title of TITLES_BY_LENGTH) {
    if (containsTitlePhrase(postingTitle, title)) return title;
  }

  if (!MANAGERIAL_TITLE_PATTERNS.some((pattern) => pattern.test(postingTitle))) return null;

  const normalized = normalizePostingTitle(postingTitle);
  if (/\b(?:manager|mgr)\b/.test(normalized)) return "Manager";
  if (/\bdirector\b/.test(normalized)) return "Director";
  if (/\bhead\b/.test(normalized)) return "Head";
  if (/\b(?:lead|leader)\b/.test(normalized)) return "Lead";
  if (/\bprincipal\b/.test(normalized)) return "Principal";
  if (/\bsuperintendent\b/.test(normalized)) return "Superintendent";
  if (/\bsupervisor\b/.test(normalized)) return "Supervisor";
  if (/\bcontroller\b/.test(normalized)) return "Controller";
  if (/\bcounsel\b/.test(normalized)) return "Senior Counsel";
  if (/\bpartner\b/.test(normalized)) return "Partner";
  if (/\btechnical authority\b/.test(normalized)) return "Technical Authority";
  if (/\b(?:product|program|programme|portfolio) owner\b/.test(normalized)) return "Product Owner";
  if (/\b(?:specialist|officer)\b/.test(normalized)) return "Senior Specialist";
  if (/\badvisor\b/.test(normalized)) return "Senior Advisor";
  return "Principal";
}

export function isTargetManagerialTitle(postingTitle: string): boolean {
  return matchTargetTitle(postingTitle) !== null;
}

export function matchFunctionalDomain(postingTitle: string): string | null {
  const title = matchTargetTitle(postingTitle);
  return title ? DOMAIN_BY_TITLE.get(title) || null : null;
}

// Legacy OR-query groups retained only for the disabled public LinkedIn
// crawler and easy rollback. Live providers use the broader generated title
// taxonomy and shared managerial patterns above.
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
