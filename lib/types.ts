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
  sample: boolean; // true when returned from local sample data (no JSearch key)
  note?: string;
}

export interface AuditTrailEntry {
  statement: string; // a claim made in the tailored CV
  source: string; // the master CV section/line it's drawn from
}

export interface Analysis {
  score: number; // 0-100
  tier: "strong" | "good" | "partial" | "weak";
  tierLabel: string;
  verdict: string;
  reasons: string[];
  tailoredCV: string; // markdown
  coverLetter: string;
  gapAnalysis: string;
  auditTrail: AuditTrailEntry[];
  demo?: boolean;
  demoNote?: string;
}

export interface BatchItem {
  job: Job;
  analysis?: Analysis;
  status: "pending" | "analyzing" | "done" | "error";
  error?: string;
}
