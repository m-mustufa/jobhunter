"use client";

import { useEffect, useRef, useState } from "react";
import { Analysis, Job, JobsResponse } from "@/lib/types";
import { DEFAULT_MASTER_CV } from "@/lib/masterCV";

export default function Home() {
  const [role, setRole] = useState("Senior Full-Stack Engineer");
  const [location, setLocation] = useState("Abu Dhabi");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [selected, setSelected] = useState<Job | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [tab, setTab] = useState<"cv" | "letter">("cv");

  const [masterCV, setMasterCV] = useState(DEFAULT_MASTER_CV);
  const [showCV, setShowCV] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function findJobs() {
    setLoadingJobs(true);
    setSearched(true);
    setSelected(null);
    setAnalysis(null);
    setAnalyzeError(null);
    try {
      const r = await fetch(
        `/api/jobs?role=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}`
      );
      const data: JobsResponse = await r.json();
      setJobs(data.jobs || []);
      setSampleNote(data.sample ? data.note || "Showing sample jobs." : null);
    } catch {
      setJobs([]);
      setSampleNote("Could not reach the jobs service.");
    } finally {
      setLoadingJobs(false);
    }
  }

  async function analyze(job: Job) {
    setSelected(job);
    setAnalysis(null);
    setAnalyzeError(null);
    setAnalyzing(true);
    setTab("cv");
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job, masterCV }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Analysis failed.");
      setAnalysis(data);
    } catch (e: any) {
      setAnalyzeError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <main className="mx-auto max-w-6xl px-5 pb-24">
      {/* Header */}
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-beacon" />
          </span>
          <div>
            <div className="font-display text-lg font-semibold tracking-tight text-bright">
              Job<span className="text-beacon">Hunter</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowCV(true)}
          className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
        >
          Master CV
        </button>
      </header>

      {/* Hero + search */}
      <section className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-beacon/80">
          Live application agent
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-bright sm:text-4xl">
          Real jobs in. A tailored CV out.
        </h1>
        <p className="mt-3 max-w-xl text-soft">
          Search live listings, and for any role the agent scores your fit and
          rewrites your CV to match — truthfully, in seconds.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field
            label="Role"
            value={role}
            onChange={setRole}
            placeholder="e.g. Full-Stack Engineer"
            onEnter={findJobs}
          />
          <Field
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="e.g. Abu Dhabi"
            onEnter={findJobs}
          />
          <button
            onClick={findJobs}
            disabled={loadingJobs}
            className="mt-auto rounded-lg bg-beacon px-6 py-3 font-medium text-ink transition hover:brightness-105 disabled:opacity-60"
          >
            {loadingJobs ? "Searching…" : "Find jobs"}
          </button>
        </div>
        {sampleNote && (
          <p className="mt-3 font-mono text-xs text-soft/80">▹ {sampleNote}</p>
        )}
      </section>

      {/* Results */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Job list */}
        <div className="space-y-3">
          {!searched && <ListHint />}
          {searched && !loadingJobs && jobs.length === 0 && (
            <div className="rounded-xl border border-line bg-surface p-6 text-soft">
              No listings came back. Try a broader role or a different location.
            </div>
          )}
          {loadingJobs &&
            [0, 1, 2].map((i) => <JobSkeleton key={i} />)}
          {!loadingJobs &&
            jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                active={selected?.id === job.id}
                onAnalyze={() => analyze(job)}
              />
            ))}
        </div>

        {/* Analysis panel */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <AnalysisPanel
            job={selected}
            analysis={analysis}
            analyzing={analyzing}
            error={analyzeError}
            tab={tab}
            setTab={setTab}
            copy={copy}
            copied={copied}
          />
        </div>
      </section>

      {/* Master CV drawer */}
      {showCV && (
        <CVEditor
          value={masterCV}
          onChange={setMasterCV}
          onClose={() => setShowCV(false)}
        />
      )}

      <footer className="mt-16 border-t border-line pt-5 text-center font-mono text-xs text-soft/70">
        JobHunter demo — jobs via JSearch (Google for Jobs), tailoring via Claude.
      </footer>
    </main>
  );
}

/* ---------- components ---------- */

function Field({
  label,
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-bright outline-none transition placeholder:text-soft/50 focus:border-beacon/70"
      />
    </label>
  );
}

function ListHint() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/50 p-8 text-center">
      <div className="font-mono text-xs uppercase tracking-[0.15em] text-soft">
        Waiting
      </div>
      <p className="mt-2 text-soft">
        Run a search to pull live listings. Pick any job to see your fit score
        and a tailored CV.
      </p>
    </div>
  );
}

function JobSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface p-4">
      <div className="relative h-4 w-2/3 overflow-hidden rounded bg-raised">
        <span className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      </div>
      <div className="mt-3 h-3 w-1/3 rounded bg-raised" />
      <div className="mt-4 h-8 w-28 rounded bg-raised" />
    </div>
  );
}

function JobCard({
  job,
  active,
  onAnalyze,
}: {
  job: Job;
  active: boolean;
  onAnalyze: () => void;
}) {
  return (
    <article
      className={`rounded-xl border bg-surface p-4 transition ${
        active ? "border-beacon shadow-[0_0_0_1px_rgba(242,177,60,0.5)]" : "border-line hover:border-line/80"
      }`}
    >
      <h3 className="font-display font-semibold leading-snug text-bright">
        {job.title}
      </h3>
      <p className="mt-0.5 text-sm text-soft">
        {job.company}
        {job.location ? ` · ${job.location}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {job.salary && (
          <span className="rounded-md border border-good/30 bg-good/10 px-2 py-0.5 font-mono text-xs text-good">
            {job.salary}
          </span>
        )}
        {job.source && (
          <span className="font-mono text-[11px] text-soft/70">{job.source}</span>
        )}
        {job.postedAt && (
          <span className="font-mono text-[11px] text-soft/50">· {job.postedAt}</span>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onAnalyze}
          className="rounded-lg border border-beacon/50 bg-beacon/10 px-3.5 py-2 text-sm font-medium text-beacon transition hover:bg-beacon/20"
        >
          {active ? "Re-analyze fit" : "Analyze fit"}
        </button>
        {job.applyLink && (
          <a
            href={job.applyLink}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-soft underline-offset-4 hover:text-bright hover:underline"
          >
            View posting ↗
          </a>
        )}
      </div>
    </article>
  );
}

function AnalysisPanel({
  job,
  analysis,
  analyzing,
  error,
  tab,
  setTab,
  copy,
  copied,
}: {
  job: Job | null;
  analysis: Analysis | null;
  analyzing: boolean;
  error: string | null;
  tab: "cv" | "letter";
  setTab: (t: "cv" | "letter") => void;
  copy: (t: string, label: string) => void;
  copied: string | null;
}) {
  if (!job) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-line bg-surface p-8 text-center">
        <ScoreRing score={0} idle />
        <p className="mt-5 max-w-xs text-soft">
          Pick a job on the left. The agent will score your fit and tailor your
          CV to that exact posting.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
        Analysis
      </div>
      <h2 className="font-display text-lg font-semibold leading-snug text-bright">
        {job.title}
      </h2>
      <p className="text-sm text-soft">{job.company}</p>

      {analyzing && (
        <div className="mt-6 flex items-center gap-3 text-soft">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-beacon" />
          </span>
          Reading the description, scoring fit, tailoring your CV…
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {analysis && !analyzing && (
        <div className="mt-5">
          <div className="flex items-center gap-5">
            <ScoreRing score={analysis.score} />
            <div>
              <div className="font-display text-sm text-soft">Match</div>
              <p className="font-display text-base font-medium text-bright">
                {analysis.verdict}
              </p>
            </div>
          </div>

          {analysis.reasons.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {analysis.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-soft">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-beacon/70" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Tabs */}
          <div className="mt-6 flex gap-1 rounded-lg border border-line bg-ink p-1">
            <TabBtn active={tab === "cv"} onClick={() => setTab("cv")}>
              Tailored CV
            </TabBtn>
            <TabBtn active={tab === "letter"} onClick={() => setTab("letter")}>
              Cover letter
            </TabBtn>
          </div>

          <div className="mt-3">
            <div className="mb-2 flex justify-end">
              <button
                onClick={() =>
                  copy(
                    tab === "cv" ? analysis.tailoredCV : analysis.coverLetter,
                    tab
                  )
                }
                className="font-mono text-xs text-soft transition hover:text-beacon"
              >
                {copied === tab ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div className="scroll-thin max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-ink p-4 text-sm leading-relaxed text-bright/90">
              {tab === "cv" ? analysis.tailoredCV : analysis.coverLetter}
            </div>
          </div>

          {job.applyLink && (
            <a
              href={job.applyLink}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block rounded-lg bg-beacon px-5 py-2.5 text-sm font-medium text-ink transition hover:brightness-105"
            >
              Apply with this CV ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
        active ? "bg-raised text-bright" : "text-soft hover:text-bright"
      }`}
    >
      {children}
    </button>
  );
}

function ScoreRing({ score, idle }: { score: number; idle?: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (idle) return;
    let raf = 0;
    const start = performance.now();
    const dur = 700;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setShown(Math.round(p * score));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score, idle]);

  const r = 34;
  const c = 2 * Math.PI * r;
  const off = c - (c * (idle ? 0 : shown)) / 100;
  const color = shown >= 75 ? "#5ecb8f" : shown >= 50 ? "#f2b13c" : "#e0793c";

  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#243049" strokeWidth="7" />
        {!idle && (
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
            style={{ transition: "stroke-dashoffset 0.1s linear" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {idle ? (
          <span className="font-mono text-xs text-soft/60">--</span>
        ) : (
          <>
            <span className="font-display text-2xl font-semibold text-bright">
              {shown}
            </span>
            <span className="font-mono text-[10px] text-soft">/ 100</span>
          </>
        )}
      </div>
    </div>
  );
}

function CVEditor({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-line bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-bright">
              Master CV
            </h2>
            <p className="text-sm text-soft">
              The single source of truth. Tailoring only re-emphasizes what's here.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:text-bright"
          >
            Done
          </button>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="scroll-thin mt-4 flex-1 resize-none rounded-lg border border-line bg-ink p-4 font-mono text-sm leading-relaxed text-bright/90 outline-none focus:border-beacon/60"
        />
      </div>
    </div>
  );
}
