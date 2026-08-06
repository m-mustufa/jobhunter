export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  description: string;
  applyLink: string | null;
  source: string | null;
  postedAt: string | null;
}

export interface JobsResponse {
  jobs: Job[];
  sample: boolean; // true when returned from local sample data (no live-jobs key)
  note?: string;
  error?: string;
  providerSyncedAt?: number;
  nextProviderSyncAt?: number;
}

export interface AuditTrailEntry {
  statement: string; // a claim made in the tailored CV
  source: string; // the master CV section/line it's drawn from
}

export interface ExperienceEntry {
  company: string;
  role: string;
  dates: string;
  bullets: string[];
}

export interface TailoredCVContent {
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: string[];
}

// A raw uploaded resume file kept for reference/preview on the Profile page
// — the Master CV tab (a Markdown string) is the actual source tailoring
// reads from; this is just "what did I last upload" for the user to check.
export interface ResumeFile {
  name: string;
  type: string; // MIME type, e.g. "application/pdf"
  dataUrl: string;
}

// The candidate's full structured resume — contact info plus content.
// Master CV (a Markdown string) is generated FROM this via
// lib/masterCV.ts's buildMasterCVMarkdown, so the two can't drift apart.
export interface Profile {
  name: string;
  title: string;
  location: string;
  email: string;
  phone: string;
  links: string[];
  photo: string; // JPEG data URL, or "" if none set
  cvFormat: "pdf" | "docx" | "both"; // which files "Apply with this CV" downloads
  cvTemplate: string; // key into lib/pdf/cvTemplates.ts's CV_TEMPLATES registry
  resumeFile: ResumeFile | null;
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: string[];
  certifications: string[];
  languages: string[];
}

export interface Analysis {
  score: number; // 0-100
  tier: "strong" | "good" | "partial" | "weak";
  tierLabel: string;
  verdict: string;
  reasons: string[];
  tailoredCV: TailoredCVContent;
  coverLetter: string;
  auditTrail: AuditTrailEntry[];
  demo?: boolean;
  demoNote?: string;
}

export interface BatchItem {
  job: Job;
  analysis?: Analysis;
  tailoredAt?: number;
  status: "pending" | "analyzing" | "done" | "error";
  error?: string;
}
