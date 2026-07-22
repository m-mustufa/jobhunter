import { Job } from "@/lib/types";
import { analyzeJobForCandidate } from "@/lib/analyzeJob";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 4;
const MAX_JOBS = 30;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400 });
  }

  const jobs: Job[] = Array.isArray(body?.jobs) ? body.jobs.slice(0, MAX_JOBS) : [];
  const masterCV: string = body?.masterCV || "";

  if (!jobs.length || !masterCV) {
    return new Response(JSON.stringify({ error: "At least one job and a master CV are required." }), {
      status: 400,
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const queue = [...jobs];

      async function worker() {
        while (queue.length) {
          const job = queue.shift();
          if (!job) return;
          try {
            const analysis = await analyzeJobForCandidate(job, masterCV);
            controller.enqueue(encoder.encode(JSON.stringify({ jobId: job.id, analysis }) + "\n"));
          } catch (err: any) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ jobId: job.id, error: err?.message || "Analysis failed." }) + "\n")
            );
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
