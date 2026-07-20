import { NextResponse } from "next/server";
import { Job, JobsResponse } from "@/lib/types";
import { SAMPLE_JOBS } from "@/lib/sampleJobs";

export const dynamic = "force-dynamic";

function formatSalary(job: any): string | null {
  const min = job.job_min_salary;
  const max = job.job_max_salary;
  const cur = job.job_salary_currency || "";
  const period = job.job_salary_period ? `/ ${String(job.job_salary_period).toLowerCase()}` : "";
  if (min && max) return `${cur} ${Math.round(min).toLocaleString()} – ${Math.round(max).toLocaleString()} ${period}`.trim();
  if (min) return `${cur} ${Math.round(min).toLocaleString()}+ ${period}`.trim();
  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const role = (searchParams.get("role") || "full stack developer").trim();
  const location = (searchParams.get("location") || "Abu Dhabi").trim();
  const key = process.env.JSEARCH_API_KEY;

  // No key configured — return sample data so the demo still works.
  if (!key) {
    const res: JobsResponse = {
      jobs: SAMPLE_JOBS,
      sample: true,
      note: "Showing sample jobs. Add JSEARCH_API_KEY to pull live listings.",
    };
    return NextResponse.json(res);
  }

  try {
    const query = encodeURIComponent(`${role} in ${location}`);
    const url = `https://jsearch.p.rapidapi.com/search?query=${query}&page=1&num_pages=1`;
    const r = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
      },
      cache: "no-store",
    });

    if (!r.ok) throw new Error(`JSearch responded ${r.status}`);
    const data = await r.json();

    const jobs: Job[] = (data.data || []).map((j: any) => ({
      id: j.job_id,
      title: j.job_title,
      company: j.employer_name,
      location: [j.job_city, j.job_country].filter(Boolean).join(", ") || location,
      salary: formatSalary(j),
      description: j.job_description || "",
      applyLink: j.job_apply_link || null,
      source: j.job_publisher || null,
      postedAt: j.job_posted_at_datetime_utc
        ? new Date(j.job_posted_at_datetime_utc).toLocaleDateString()
        : null,
    }));

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
