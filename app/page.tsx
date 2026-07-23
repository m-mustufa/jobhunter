"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Analysis, BatchItem, Job, JobsResponse, Profile, TailoredCVContent } from "@/lib/types";
import { DEFAULT_MASTER_CV } from "@/lib/masterCV";
import { DEFAULT_PROFILE } from "@/lib/profile";
import { EMPLOYER_DIRECTORY, linkedInSearchUrl } from "@/lib/employerDirectory";
import { getMatchTier } from "@/lib/matchTier";
import { FUNCTIONAL_DOMAINS, matchFunctionalDomain, matchTargetTitle } from "@/lib/targetRoles";
import { loadJSON, saveJSON } from "@/lib/persist";
import { buildCVDocument, buildCoverLetterDocument, serializeCVText } from "@/lib/cvDocument";
import { downloadBlobsStaggered, safeFileSlug } from "@/lib/download";

const MASTER_CV_KEY = "jobhunter:masterCV";
const PROFILE_KEY = "jobhunter:profile";

const TIER_COLOR: Record<string, string> = {
  strong: "#5ecb8f",
  good: "#f2b13c",
  partial: "#e0793c",
  weak: "#c9506a",
};

const PAGE_SIZE = 10;
const OTHER = "Other";

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"cv" | "letter">("cv");

  const [titleFilter, setTitleFilter] = useState("all");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [masterCV, setMasterCV] = useState(DEFAULT_MASTER_CV);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [showProfile, setShowProfile] = useState(false);
  const [showEmployers, setShowEmployers] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // e.g. "cv:<jobId>" | "letter:<jobId>"

  // Hydrate persisted Master CV / Profile after mount (kept out of the
  // initial useState so server- and first-client-render markup match).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setMasterCV(loadJSON(MASTER_CV_KEY, DEFAULT_MASTER_CV));
    setProfile(loadJSON(PROFILE_KEY, DEFAULT_PROFILE));
    setHydrated(true);
  }, []);

  // Gated on `hydrated` so this can't fire with default values before the
  // load above has committed and clobber what's actually in storage.
  useEffect(() => {
    if (hydrated) saveJSON(MASTER_CV_KEY, masterCV);
  }, [masterCV, hydrated]);
  useEffect(() => {
    if (hydrated) saveJSON(PROFILE_KEY, profile);
  }, [profile, hydrated]);

  const itemsRef = useRef<BatchItem[]>([]);

  function setItemsSynced(next: BatchItem[]) {
    itemsRef.current = next;
    setItems(next);
  }

  function patchItem(jobId: string, patch: Partial<BatchItem>) {
    const next = itemsRef.current.map((it) => (it.job.id === jobId ? { ...it, ...patch } : it));
    setItemsSynced(next);
  }

  async function findAndTailor() {
    setSearching(true);
    setSearched(true);
    setSelectedId(null);
    setItemsSynced([]);
    setProgress({ done: 0, total: 0 });
    setTitleFilter("all");
    setFieldFilter("all");
    setPage(1);

    let jobs: Job[] = [];
    try {
      const r = await fetch(`/api/jobs${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`);
      const data: JobsResponse = await r.json();
      jobs = data.jobs || [];
      setSampleNote(data.sample ? data.note || "Showing sample jobs." : null);
    } catch {
      setSampleNote("Could not reach the jobs service.");
    } finally {
      setSearching(false);
    }

    if (!jobs.length) return;

    const initial: BatchItem[] = jobs.map((job) => ({ job, status: "pending" }));
    setItemsSynced(initial);
    setProgress({ done: 0, total: jobs.length });
    setBatchRunning(true);

    try {
      const r = await fetch("/api/analyze-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobs, masterCV }),
      });

      if (!r.body) throw new Error("No response stream.");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneCount = 0;
      let firstJobId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed: { jobId: string; analysis?: Analysis; error?: string } = JSON.parse(line);
          doneCount += 1;
          setProgress({ done: doneCount, total: jobs.length });
          if (parsed.error) {
            patchItem(parsed.jobId, { status: "error", error: parsed.error });
          } else {
            patchItem(parsed.jobId, { status: "done", analysis: parsed.analysis });
          }
          if (!firstJobId) {
            firstJobId = parsed.jobId;
            setSelectedId(parsed.jobId);
          }
        }
      }
    } catch (e: any) {
      setSampleNote((prev) => prev || `Batch analysis failed: ${e.message}`);
    } finally {
      setBatchRunning(false);
      const sorted = [...itemsRef.current].sort((a, b) => (b.analysis?.score ?? -1) - (a.analysis?.score ?? -1));
      setItemsSynced(sorted);
    }
  }

  // Load the latest vacancies automatically on first visit.
  useEffect(() => {
    findAndTailor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  function fileSlug(job: Job) {
    return `${safeFileSlug(profile.name || "candidate")}-${safeFileSlug(job.title)}`;
  }

  async function downloadCV(item: BatchItem) {
    if (!item.analysis) return;
    const key = `cv:${item.job.id}`;
    setBusy(key);
    try {
      const [{ generateCVPdfBlob }, { buildCVDocxBlob }] = await Promise.all([
        import("@/lib/pdf/generate"),
        import("@/lib/docx/buildCVDocx"),
      ]);
      const doc = buildCVDocument(profile, item.analysis.tailoredCV);
      const slug = fileSlug(item.job);
      const [pdfBlob, docxBlob] = await Promise.all([generateCVPdfBlob(doc), buildCVDocxBlob(doc)]);
      await downloadBlobsStaggered([
        { blob: pdfBlob, filename: `${slug}-CV.pdf` },
        { blob: docxBlob, filename: `${slug}-CV.docx` },
      ]);
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  async function downloadCoverLetter(item: BatchItem) {
    if (!item.analysis) return;
    const key = `letter:${item.job.id}`;
    setBusy(key);
    try {
      const [{ generateCoverLetterPdfBlob }, { buildCoverLetterDocxBlob }] = await Promise.all([
        import("@/lib/pdf/generate"),
        import("@/lib/docx/buildCoverLetterDocx"),
      ]);
      const doc = buildCoverLetterDocument(profile, item.job, item.analysis.coverLetter);
      const slug = fileSlug(item.job);
      const [pdfBlob, docxBlob] = await Promise.all([
        generateCoverLetterPdfBlob(doc),
        buildCoverLetterDocxBlob(doc),
      ]);
      await downloadBlobsStaggered([
        { blob: pdfBlob, filename: `${slug}-CoverLetter.pdf` },
        { blob: docxBlob, filename: `${slug}-CoverLetter.docx` },
      ]);
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  function applyWithCV(item: BatchItem) {
    // Open the posting first, synchronously, so the popup blocker doesn't
    // catch it once the async PDF/DOCX generation below kicks in.
    if (item.job.applyLink) window.open(item.job.applyLink, "_blank", "noopener,noreferrer");
    downloadCV(item);
  }

  async function importResumeFile(file: File) {
    const replaceMasterCV =
      !masterCV.trim() ||
      confirm("Replace your current Master CV with the content extracted from this file?");

    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch("/api/parse-resume", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) {
        alert(data.error || "Could not read that file.");
        return;
      }
      setProfile((p) => ({ ...p, ...data.profile }));
      if (replaceMasterCV) setMasterCV(data.masterCV);
    } catch {
      alert("Could not reach the resume-parsing service.");
    }
  }

  const selected = items.find((it) => it.job.id === selectedId) || null;

  const titleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(matchTargetTitle(it.job.title) || OTHER);
    return [...set].sort();
  }, [items]);

  const domainOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(matchFunctionalDomain(it.job.title) || OTHER);
    return FUNCTIONAL_DOMAINS.map((d) => d.domain).filter((d) => set.has(d)).concat(set.has(OTHER) ? [OTHER] : []);
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      const titleOk = titleFilter === "all" || (matchTargetTitle(it.job.title) || OTHER) === titleFilter;
      const fieldOk = fieldFilter === "all" || (matchFunctionalDomain(it.job.title) || OTHER) === fieldFilter;
      return titleOk && fieldOk;
    });
  }, [items, titleFilter, fieldFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function updateTitleFilter(v: string) {
    setTitleFilter(v);
    setPage(1);
  }

  function updateFieldFilter(v: string) {
    setFieldFilter(v);
    setPage(1);
  }

  return (
    <main className="mx-auto max-w-6xl px-5 pb-24">
      {/* Header */}
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-1">
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowEmployers(true)}
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
          >
            Employers
          </button>
          <button
            onClick={() => setShowProfile(true)}
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
          >
            Profile & CV
          </button>
        </div>
      </header>

      {/* Hero + search */}
      <section className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-beacon/80">
          Live application agent
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-bright sm:text-4xl">
          Every open vacancy in Abu Dhabi. Tailored CVs for all of them.
        </h1>
        <p className="mt-3 max-w-xl text-soft">
          One click searches VP-through-Team-Lead roles across Abu Dhabi, scores your
          fit against every vacancy, and tailors a CV + cover letter for each one —
          truthfully, in one pass.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field
            label="Narrow by keyword (optional)"
            value={keyword}
            onChange={setKeyword}
            placeholder="e.g. Engineering, Finance, Procurement"
            onEnter={findAndTailor}
          />
          <button
            onClick={findAndTailor}
            disabled={searching || batchRunning}
            className="mt-auto rounded-lg bg-beacon px-6 py-3 font-medium text-ink transition hover:brightness-105 disabled:opacity-60"
          >
            {searching ? "Searching…" : batchRunning ? "Tailoring…" : "Find & tailor all matches"}
          </button>
        </div>
        {sampleNote && (
          <p className="mt-3 font-mono text-xs text-soft/80">▹ {sampleNote}</p>
        )}
        {(searching || batchRunning) && (
          <div className="mt-3 flex items-center gap-3 font-mono text-xs text-soft">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-beacon" />
            </span>
            {searching
              ? "Searching Abu Dhabi vacancies across ~30 target titles…"
              : `Analyzing ${progress.done} of ${progress.total} vacancies…`}
          </div>
        )}
      </section>

      {/* Results */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Job list */}
        <div className="space-y-3">
          {!searched && <ListHint />}

          {searched && items.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Title"
                value={titleFilter}
                onChange={updateTitleFilter}
                options={[{ value: "all", label: "All titles" }, ...titleOptions.map((t) => ({ value: t, label: t }))]}
              />
              <Select
                label="Field"
                value={fieldFilter}
                onChange={updateFieldFilter}
                options={[{ value: "all", label: "All fields" }, ...domainOptions.map((d) => ({ value: d, label: d }))]}
              />
            </div>
          )}

          {searched && !searching && filteredItems.length === 0 && (
            <div className="rounded-xl border border-line bg-surface p-6 text-soft">
              {items.length === 0
                ? "No listings came back. Try a different keyword or clear it to search everything."
                : "No vacancies match the current filters."}
            </div>
          )}
          {searching &&
            [0, 1, 2].map((i) => <JobSkeleton key={i} />)}
          {!searching &&
            pageItems.map((item) => (
              <JobCard
                key={item.job.id}
                item={item}
                active={selectedId === item.job.id}
                onSelect={() => {
                  setSelectedId(item.job.id);
                  setTab("cv");
                }}
              />
            ))}

          {!searching && filteredItems.length > 0 && (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              total={filteredItems.length}
              onChange={setPage}
            />
          )}
        </div>

        {/* Analysis panel */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <AnalysisPanel
            item={selected}
            profile={profile}
            tab={tab}
            setTab={setTab}
            copy={copy}
            copied={copied}
            busy={busy}
            onApply={applyWithCV}
            onDownloadLetter={downloadCoverLetter}
          />
        </div>
      </section>

      {/* Profile & Master CV drawer */}
      {showProfile && (
        <ProfileDrawer
          profile={profile}
          onProfileChange={setProfile}
          masterCV={masterCV}
          onMasterCVChange={setMasterCV}
          onImportFile={importResumeFile}
          onClose={() => setShowProfile(false)}
        />
      )}

      {/* Employer directory drawer */}
      {showEmployers && <EmployerDirectory onClose={() => setShowEmployers(false)} />}

      <footer className="mt-16 border-t border-line pt-5 text-center font-mono text-xs text-soft/70">
        JobHunter — jobs via JSearch (Google for Jobs), scoring + tailoring via Claude.
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

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-bright outline-none transition focus:border-beacon/70"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-1">
      <span className="font-mono text-xs text-soft/70">
        Page {page} of {totalPages} · {total} vacancies
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-soft transition hover:border-beacon/60 hover:text-bright disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-soft transition hover:border-beacon/60 hover:text-bright disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ListHint() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/50 p-8 text-center">
      <div className="font-mono text-xs uppercase tracking-[0.15em] text-soft">
        Waiting
      </div>
      <p className="mt-2 text-soft">
        Click "Find & tailor all matches" to pull every open Abu Dhabi vacancy across
        the target role list, score your fit, and tailor a CV for each one.
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

function TierBadge({ tier, label }: { tier: string; label: string }) {
  const color = TIER_COLOR[tier] || "#8b98b4";
  return (
    <span
      className="rounded-md border px-2 py-0.5 font-mono text-xs"
      style={{ borderColor: `${color}4d`, backgroundColor: `${color}1a`, color }}
    >
      {label}
    </span>
  );
}

function JobCard({
  item,
  active,
  onSelect,
}: {
  item: BatchItem;
  active: boolean;
  onSelect: () => void;
}) {
  const { job, analysis, status } = item;
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border bg-surface p-4 transition ${
        active ? "border-beacon shadow-[0_0_0_1px_rgba(242,177,60,0.5)]" : "border-line hover:border-line/80"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold leading-snug text-bright">
            {job.title}
          </h3>
          <p className="mt-0.5 text-sm text-soft">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
          </p>
        </div>
        {analysis && (
          <div className="shrink-0 text-right">
            <div className="font-display text-lg font-semibold text-bright">{analysis.score}</div>
            <div className="font-mono text-[10px] text-soft/60">/ 100</div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {analysis && <TierBadge tier={analysis.tier} label={analysis.tierLabel} />}
        {status === "pending" && (
          <span className="font-mono text-xs text-soft/60">Queued…</span>
        )}
        {status === "analyzing" && (
          <span className="font-mono text-xs text-beacon">Analyzing…</span>
        )}
        {status === "error" && (
          <span className="font-mono text-xs text-weak">Analysis failed</span>
        )}
        {job.salary && (
          <span className="rounded-md border border-good/30 bg-good/10 px-2 py-0.5 font-mono text-xs text-good">
            {job.salary}
          </span>
        )}
        {job.source && (
          <span className="font-mono text-[11px] text-soft/70">{job.source}</span>
        )}
      </div>

      {job.applyLink && (
        <div className="mt-3">
          <a
            href={job.applyLink}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-soft underline-offset-4 hover:text-bright hover:underline"
          >
            View posting ↗
          </a>
        </div>
      )}
    </article>
  );
}

function AnalysisPanel({
  item,
  profile,
  tab,
  setTab,
  copy,
  copied,
  busy,
  onApply,
  onDownloadLetter,
}: {
  item: BatchItem | null;
  profile: Profile;
  tab: "cv" | "letter";
  setTab: (t: "cv" | "letter") => void;
  copy: (t: string, label: string) => void;
  copied: string | null;
  busy: string | null;
  onApply: (item: BatchItem) => void;
  onDownloadLetter: (item: BatchItem) => void;
}) {
  if (!item) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-line bg-surface p-8 text-center">
        <ScoreRing score={0} idle />
        <p className="mt-5 max-w-xs text-soft">
          Run a search. Pick any result on the left to see its fit score, tailored
          CV, cover letter, gap analysis, and audit trail.
        </p>
      </div>
    );
  }

  const { job, analysis, status, error } = item;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
        Analysis
      </div>
      <h2 className="font-display text-lg font-semibold leading-snug text-bright">
        {job.title}
      </h2>
      <p className="text-sm text-soft">{job.company}</p>

      {(status === "pending" || status === "analyzing") && (
        <div className="mt-6 flex items-center gap-3 text-soft">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-beacon" />
          </span>
          Reading the description, scoring fit, tailoring your CV…
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 rounded-lg border border-weak/30 bg-weak/10 p-4 text-sm text-weak">
          {error || "Analysis failed."}
        </div>
      )}

      {analysis && status === "done" && (
        <div className="mt-5">
          {analysis.demo && (
            <div className="mb-4 rounded-lg border border-beacon/30 bg-beacon/10 px-3 py-2.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-beacon">
                Simulated demo
              </div>
              <p className="mt-1 text-xs leading-relaxed text-soft">
                {analysis.demoNote || "Preview output generated without an AI API call."}
                {" "}Verify and edit before using it in an application.
              </p>
            </div>
          )}
          <div className="flex items-center gap-5">
            <ScoreRing score={analysis.score} />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-sm text-soft">Match</span>
                <TierBadge tier={analysis.tier} label={analysis.tierLabel} />
              </div>
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

          {analysis.gapAnalysis && (
            <div className="mt-4 rounded-lg border border-line bg-ink/60 p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-soft">
                Gap analysis
              </div>
              <p className="mt-1 text-sm leading-relaxed text-soft">{analysis.gapAnalysis}</p>
            </div>
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
            <div className="mb-2 flex justify-end gap-3">
              {tab === "letter" && (
                <button
                  onClick={() => onDownloadLetter(item)}
                  disabled={busy === `letter:${job.id}`}
                  className="font-mono text-xs text-soft transition hover:text-beacon disabled:opacity-50"
                >
                  {busy === `letter:${job.id}` ? "Preparing…" : "Download (PDF + DOCX)"}
                </button>
              )}
              <button
                onClick={() =>
                  copy(
                    tab === "cv" ? serializeCVText(profile, analysis.tailoredCV) : analysis.coverLetter,
                    tab
                  )
                }
                className="font-mono text-xs text-soft transition hover:text-beacon"
              >
                {copied === tab ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <div className="scroll-thin max-h-[420px] overflow-y-auto rounded-lg border border-line bg-ink p-4 text-sm leading-relaxed text-bright/90">
              {tab === "cv" ? (
                <TailoredCVPreview cv={analysis.tailoredCV} />
              ) : (
                <p className="whitespace-pre-wrap">{analysis.coverLetter}</p>
              )}
            </div>
          </div>

          {analysis.auditTrail.length > 0 && (
            <details className="mt-4 rounded-lg border border-line bg-ink/60 p-3">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.15em] text-soft">
                Audit trail ({analysis.auditTrail.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {analysis.auditTrail.map((e, i) => (
                  <li key={i} className="text-sm text-soft">
                    <span className="text-bright/90">{e.statement}</span>
                    <span className="block font-mono text-xs text-soft/60">→ {e.source}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            onClick={() => onApply(item)}
            disabled={busy === `cv:${job.id}`}
            className="mt-4 inline-block rounded-lg bg-beacon px-5 py-2.5 text-sm font-medium text-ink transition hover:brightness-105 disabled:opacity-60"
          >
            {busy === `cv:${job.id}` ? "Preparing your CV…" : "Apply with this CV ↗"}
          </button>
          <p className="mt-2 font-mono text-[10px] text-soft/60">
            Opens the posting and downloads a ready-to-attach CV (PDF + DOCX).
          </p>
        </div>
      )}
    </div>
  );
}

function TailoredCVPreview({ cv }: { cv: TailoredCVContent }) {
  return (
    <div className="space-y-4">
      {cv.summary && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-soft">Summary</div>
          <p className="mt-1">{cv.summary}</p>
        </div>
      )}
      {cv.skills.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-soft">Core Skills</div>
          <p className="mt-1">{cv.skills.join(" · ")}</p>
        </div>
      )}
      {cv.experience.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-soft">Experience</div>
          <div className="mt-1 space-y-3">
            {cv.experience.map((e, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-bright/90">
                    {[e.role, e.company].filter(Boolean).join(" — ")}
                  </span>
                  {e.dates && <span className="shrink-0 text-xs text-soft/70">{e.dates}</span>}
                </div>
                <ul className="mt-1 space-y-1">
                  {e.bullets.map((b, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-soft/70" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {cv.education.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-soft">Education</div>
          <div className="mt-1 space-y-1">
            {cv.education.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
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
  const r = 34;
  const c = 2 * Math.PI * r;
  const off = c - (c * (idle ? 0 : score)) / 100;
  const tier = getMatchTier(score);
  const color = TIER_COLOR[tier.key];

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
            style={{ transition: "stroke-dashoffset 0.4s ease" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {idle ? (
          <span className="font-mono text-xs text-soft/60">--</span>
        ) : (
          <>
            <span className="font-display text-2xl font-semibold text-bright">
              {score}
            </span>
            <span className="font-mono text-[10px] text-soft">/ 100</span>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileDrawer({
  profile,
  onProfileChange,
  masterCV,
  onMasterCVChange,
  onImportFile,
  onClose,
}: {
  profile: Profile;
  onProfileChange: (p: Profile) => void;
  masterCV: string;
  onMasterCVChange: (v: string) => void;
  onImportFile: (file: File) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "cv">("profile");

  function updateField<K extends keyof Profile>(key: K, value: Profile[K]) {
    onProfileChange({ ...profile, [key]: value });
  }

  function updateLink(i: number, value: string) {
    const links = [...profile.links];
    links[i] = value;
    updateField("links", links);
  }

  function addLink() {
    updateField("links", [...profile.links, ""]);
  }

  function removeLink(i: number) {
    updateField(
      "links",
      profile.links.filter((_, idx) => idx !== i)
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-line bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-bright">Profile & CV</h2>
            <p className="text-sm text-soft">
              Contact details fill the header of every generated document. Master CV
              stays the tailoring source, unchanged.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:text-bright"
          >
            Done
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-lg border border-line bg-ink p-1">
          <TabBtn active={tab === "profile"} onClick={() => setTab("profile")}>
            Profile
          </TabBtn>
          <TabBtn active={tab === "cv"} onClick={() => setTab("cv")}>
            Master CV
          </TabBtn>
        </div>

        {tab === "profile" ? (
          <div className="scroll-thin mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
                Import from CV
              </span>
              <input
                type="file"
                accept=".pdf,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportFile(f);
                  e.target.value = "";
                }}
                className="block w-full text-sm text-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-raised file:px-3 file:py-2 file:text-sm file:text-soft"
              />
              <span className="mt-1 block text-xs text-soft/70">
                Upload a .pdf or .docx resume (e.g. LinkedIn's own "Save to PDF" export
                from your profile page) to prefill these fields.
              </span>
            </label>

            <ProfileField label="Full name" value={profile.name} onChange={(v) => updateField("name", v)} />
            <ProfileField label="Title" value={profile.title} onChange={(v) => updateField("title", v)} />
            <ProfileField label="Location" value={profile.location} onChange={(v) => updateField("location", v)} />
            <ProfileField label="Email" value={profile.email} onChange={(v) => updateField("email", v)} />
            <ProfileField label="Phone" value={profile.phone} onChange={(v) => updateField("phone", v)} />

            <div>
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
                Links
              </span>
              <div className="space-y-2">
                {profile.links.map((link, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={link}
                      onChange={(e) => updateLink(i, e.target.value)}
                      placeholder="linkedin.com/in/..."
                      className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-bright outline-none focus:border-beacon/60"
                    />
                    <button
                      onClick={() => removeLink(i)}
                      className="rounded-lg border border-line px-2.5 text-sm text-soft hover:text-weak"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button onClick={addLink} className="font-mono text-xs text-soft hover:text-beacon">
                  + Add link
                </button>
              </div>
            </div>
          </div>
        ) : (
          <textarea
            value={masterCV}
            onChange={(e) => onMasterCVChange(e.target.value)}
            className="scroll-thin mt-4 flex-1 resize-none rounded-lg border border-line bg-ink p-4 font-mono text-sm leading-relaxed text-bright/90 outline-none focus:border-beacon/60"
          />
        )}
      </div>
    </div>
  );
}

function ProfileField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-bright outline-none transition focus:border-beacon/60"
      />
    </label>
  );
}

function EmployerDirectory({ onClose }: { onClose: () => void }) {
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
              Abu Dhabi Employer Directory
            </h2>
            <p className="text-sm text-soft">
              Reference list of major employers — not wired into search, browse and
              search each on LinkedIn directly.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:text-bright"
          >
            Done
          </button>
        </div>
        <div className="scroll-thin mt-4 flex-1 overflow-y-auto pr-1">
          {EMPLOYER_DIRECTORY.map((cat) => (
            <div key={cat.category} className="mb-6">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.15em] text-beacon/80">
                {cat.category}
              </h3>
              <ul className="mt-2 space-y-2">
                {cat.employers.map((emp) => (
                  <li key={emp.name} className="rounded-lg border border-line bg-ink/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-bright">{emp.name}</div>
                        <p className="mt-0.5 text-xs text-soft">{emp.blurb}</p>
                      </div>
                      <a
                        href={linkedInSearchUrl(emp.name)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 whitespace-nowrap font-mono text-xs text-soft underline-offset-4 hover:text-beacon hover:underline"
                      >
                        LinkedIn ↗
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
