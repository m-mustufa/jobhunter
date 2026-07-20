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

export interface Analysis {
  score: number; // 0-100
  verdict: string;
  reasons: string[];
  tailoredCV: string; // markdown
  coverLetter: string;
}
