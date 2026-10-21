export interface EmployerProfile {
  id: string;
  name: string;
  description: string;
  logoUrl: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  jobsSearchUrl: string;
  jobBoard: string | null;
  industries: string[];
  subindustries: string[];
  sizeMin: number | null;
  sizeMax: number | null;
  source: "reference";
}

export interface EmployersResponse {
  employers: EmployerProfile[];
  fetchedAt: number;
  source: "reference";
  fromCache: boolean;
  stale: boolean;
  note: string;
  error?: string;
}
