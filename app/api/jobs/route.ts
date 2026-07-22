import { NextResponse } from "next/server";
import { Job, JobsResponse } from "@/lib/types";
import { SAMPLE_JOBS } from "@/lib/sampleJobs";
import { QUERY_GROUPS } from "@/lib/targetRoles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONCURRENCY = 3;
const MAX_RESULTS = 30;

function formatSalary(job: any): string | null {
  const min = job.job_min_salary;
  const max = job.job_max_salary;
  const cur = job.job_salary_currency || "";
  const period = job.job_salary_period ? `/ ${String(job.job_salary_period).toLowerCase()}` : "";
  if (min && max) return `${cur} ${Math.round(min).toLocaleString()} – ${Math.round(max).toLocaleString()} ${period}`.trim();
  if (min) return `${cur} ${Math.round(min).toLocaleString()}+ ${period}`.trim();
  return null;
}

function isAbuDhabi(job: any): boolean {
  const haystack = [job.job_city, job.job_state, job.job_country, job.job_location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("abu dhabi");
}

function toJob(j: any): Job {
  return {
    id: j.job_id,
    title: j.job_title,
    company: j.employer_name,
    location: [j.job_city, j.job_country].filter(Boolean).join(", ") || "Abu Dhabi, UAE",
    salary: formatSalary(j),
    description: j.job_description || "",
    applyLink: j.job_apply_link || null,
    source: j.job_publisher || null,
    postedAt: j.job_posted_at_datetime_utc
      ? new Date(j.job_posted_at_datetime_utc).toLocaleDateString()
      : null,
  };
}

async function fetchQueryGroup(query: string, key: string): Promise<any[]> {
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&page=1&num_pages=1`;
  const r = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`JSearch responded ${r.status}`);
  const data = await r.json();
  return data.data || [];
}

// Runs the query groups with limited concurrency so we don't fire all
// requests at once against the RapidAPI rate limit.
async function runGroupsWithConcurrency(key: string): Promise<any[]> {
  const results: any[] = [];
  const queue = [...QUERY_GROUPS];

  async function worker() {
    while (queue.length) {
      const query = queue.shift();
      if (!query) return;
      try {
        const jobs = await fetchQueryGroup(query, key);
        results.push(...jobs);
      } catch {
        // fail soft per group — other groups still contribute
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return results;
}

function dedupe(rawJobs: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const j of rawJobs) {
    const key = j.job_id || `${j.job_title}::${j.employer_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = (searchParams.get("keyword") || "").trim().toLowerCase();
  const key = process.env.JSEARCH_API_KEY;

  // No key configured — return sample data so the demo still works.
  if (!key) {
    let jobs = SAMPLE_JOBS;
    if (keyword) jobs = jobs.filter((j) => `${j.title} ${j.description}`.toLowerCase().includes(keyword));
    const res: JobsResponse = {
      jobs,
      sample: true,
      note: "Showing sample jobs. Add JSEARCH_API_KEY to pull live listings.",
    };
    return NextResponse.json(res);
  }

  try {
    const raw = await runGroupsWithConcurrency(key);
    const deduped = dedupe(raw).filter(isAbuDhabi);
    let jobs: Job[] = deduped.slice(0, MAX_RESULTS).map(toJob);
    if (keyword) jobs = jobs.filter((j) => `${j.title} ${j.description}`.toLowerCase().includes(keyword));

    const res: JobsResponse = { jobs, sample: false };
    return NextResponse.json(res);
  } catch (err: any) {
    // Fail soft to sample data so a demo is never dead.
    const res: JobsResponse = {
      jobs: SAMPLE_JOBS,
      sample: true,
      note: `Live fetch failed (${err.message}). Showing sample jobs.`,
    };
    return NextResponse.json(res);
  }
}
