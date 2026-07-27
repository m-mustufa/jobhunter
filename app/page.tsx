"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Analysis, BatchItem, Job, JobsResponse, Profile, TailoredCVContent } from "@/lib/types";
import { DEFAULT_MASTER_CV } from "@/lib/masterCV";
import { DEFAULT_PROFILE, sanitizeProfile } from "@/lib/profile";
import { buildDemoAnalysis } from "@/lib/demoAnalysis";
import { EMPLOYER_DIRECTORY, linkedInSearchUrl } from "@/lib/employerDirectory";
import { getMatchTier } from "@/lib/matchTier";
import { FUNCTIONAL_DOMAINS, matchFunctionalDomain, matchTargetTitle } from "@/lib/targetRoles";
import { loadJSON, saveJSON, MASTER_CV_KEY, PROFILE_KEY, JOBS_CACHE_KEY } from "@/lib/persist";
import { buildCVDocument, buildCoverLetterDocument, serializeCVText } from "@/lib/cvDocument";
import { downloadBlobsStaggered, safeFileSlug } from "@/lib/download";
import { TabBtn } from "@/app/components/ui";

const TIER_COLOR: Record<string, string> = {
  strong: "#5ecb8f",
  good: "#f2b13c",
  partial: "#e0793c",
  weak: "#c9506a",
};

const PAGE_SIZE = 10;
const OTHER = "Other";

// Shown on every job until the user asks for the real thing — makes clear
// this score costs nothing and isn't the truthful, AI-tailored version yet.
const QUICK_MATCH_NOTE =
  'Quick match estimate, computed instantly with no AI call. Click "Tailor CV for this job" for a precise, AI-tailored CV, cover letter, and gap analysis.';

interface JobsCache {
  jobs: Job[];
  fetchedAt: number;
  keyword: string;
  sampleNote: string | null;
}

function scoreJobs(jobs: Job[], masterCV: string): BatchItem[] {
  return jobs
    .map((job) => ({ job, status: "done" as const, analysis: buildDemoAnalysis(job, masterCV, QUICK_MATCH_NOTE) }))
    .sort((a, b) => (b.analysis?.score ?? -1) - (a.analysis?.score ?? -1));
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"cv" | "letter">("cv");

  const [titleFilter, setTitleFilter] = useState("all");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [masterCV, setMasterCV] = useState(DEFAULT_MASTER_CV);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [showEmployers, setShowEmployers] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // e.g. "letter:<jobId>" | "tailor:<jobId>"
  const [actionError, setActionError] = useState<string | null>(null);

  // Hydrate persisted Master CV / Profile after mount (kept out of the
  // initial useState so server- and first-client-render markup match), then
  // either restore the last fetched job list from cache (instant, free) or
  // run a first search if nothing's cached yet.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const mCV = loadJSON(MASTER_CV_KEY, DEFAULT_MASTER_CV);
    const prof = sanitizeProfile(loadJSON(PROFILE_KEY, DEFAULT_PROFILE));
    setMasterCV(mCV);
    setProfile(prof);
    setHydrated(true);

    const cache = loadJSON<JobsCache | null>(JOBS_CACHE_KEY, null);
    if (cache && cache.jobs?.length) {
      if (cache.keyword) setKeyword(cache.keyword);
      setSampleNote(cache.sampleNote);
      setFetchedAt(cache.fetchedAt);
      setSearched(true);
      const scored = scoreJobs(cache.jobs, mCV);
      setItemsSynced(scored);
      setSelectedId(scored[0]?.job.id ?? null);
    } else {
      runSearch(mCV);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Fetches jobs and scores every one instantly with the free heuristic
  // scorer (no AI call) — real, AI-tailored CVs/cover letters are generated
  // per-job, on demand, only when the user clicks "Tailor CV for this job"
  // (see tailorJob below). Keeps this to one fetch that both the initial
  // load and the explicit "Refresh listings" action can call.
  async function runSearch(masterCVOverride?: string) {
    const cv = masterCVOverride ?? masterCV;
    setSearching(true);
    setSearched(true);
    setSelectedId(null);
    setItemsSynced([]);
    setActionError(null);
    setTitleFilter("all");
    setFieldFilter("all");
    setPage(1);

    let jobs: Job[] = [];
    let note: string | null = null;
    try {
      const r = await fetch(`/api/jobs${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`);
      const data: JobsResponse = await r.json();
      jobs = data.jobs || [];
      note = data.sample ? data.note || "Showing sample jobs." : null;
    } catch {
      note = "Could not reach the jobs service.";
    } finally {
      setSearching(false);
    }
    setSampleNote(note);

    if (!jobs.length) return;

    const scored = scoreJobs(jobs, cv);
    setItemsSynced(scored);
    setSelectedId(scored[0]?.job.id ?? null);

    const now = Date.now();
    setFetchedAt(now);
    saveJSON(JOBS_CACHE_KEY, { jobs, fetchedAt: now, keyword, sampleNote: note });
  }

  // Runs the real, paid Claude call for exactly one job — only fired when
  // the user explicitly asks to tailor that specific vacancy, not for every
  // result in the list.
  async function tailorJob(item: BatchItem) {
    const key = `tailor:${item.job.id}`;
    setBusy(key);
    setActionError(null);
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: item.job, masterCV }),
      });
      if (!r.ok) throw new Error("Tailoring failed — try again.");
      const analysis: Analysis = await r.json();
      patchItem(item.job.id, { analysis, status: "done" });
    } catch (e: any) {
      setActionError(e?.message || "Tailoring failed — try again.");
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  function fileSlug(job: Job) {
    return `${safeFileSlug(profile.name || "candidate")}-${safeFileSlug(job.title)}`;
  }

  // Respects the user's preferred download format (Profile → CV Format):
  // "both" generates PDF + DOCX as before, "pdf"/"docx" skip generating
  // (and downloading) the format the user doesn't want.
  async function downloadCVAndCoverLetter(item: BatchItem) {
    if (!item.analysis) return;
    const format = profile.cvFormat;
    const cvDoc = buildCVDocument(profile, item.analysis.tailoredCV);
    const letterDoc = buildCoverLetterDocument(profile, item.job, item.analysis.coverLetter);
    const slug = fileSlug(item.job);
    const files: { blob: Blob; filename: string }[] = [];

    if (format !== "docx") {
      const { generateCVPdfBlob, generateCoverLetterPdfBlob } = await import("@/lib/pdf/generate");
      const [cvPdf, letterPdf] = await Promise.all([
        generateCVPdfBlob(cvDoc),
        generateCoverLetterPdfBlob(letterDoc),
      ]);
      files.push({ blob: cvPdf, filename: `${slug}-CV.pdf` }, { blob: letterPdf, filename: `${slug}-CoverLetter.pdf` });
    }
    if (format !== "pdf") {
      const [{ buildCVDocxBlob }, { buildCoverLetterDocxBlob }] = await Promise.all([
        import("@/lib/docx/buildCVDocx"),
        import("@/lib/docx/buildCoverLetterDocx"),
      ]);
      const [cvDocx, letterDocx] = await Promise.all([
        buildCVDocxBlob(cvDoc),
        buildCoverLetterDocxBlob(letterDoc),
      ]);
      files.push({ blob: cvDocx, filename: `${slug}-CV.docx` }, { blob: letterDocx, filename: `${slug}-CoverLetter.docx` });
    }
    await downloadBlobsStaggered(files);
  }

  async function downloadCoverLetter(item: BatchItem) {
    if (!item.analysis) return;
    const key = `letter:${item.job.id}`;
    setBusy(key);
    try {
      const format = profile.cvFormat;
      const doc = buildCoverLetterDocument(profile, item.job, item.analysis.coverLetter);
      const slug = fileSlug(item.job);
      const files: { blob: Blob; filename: string }[] = [];

      if (format !== "docx") {
        const { generateCoverLetterPdfBlob } = await import("@/lib/pdf/generate");
        files.push({ blob: await generateCoverLetterPdfBlob(doc), filename: `${slug}-CoverLetter.pdf` });
      }
      if (format !== "pdf") {
        const { buildCoverLetterDocxBlob } = await import("@/lib/docx/buildCoverLetterDocx");
        files.push({ blob: await buildCoverLetterDocxBlob(doc), filename: `${slug}-CoverLetter.docx` });
      }
      await downloadBlobsStaggered(files);
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  // "Apply with this CV" now opens a confirm-then-download-then-go modal
  // instead of firing everything at once: confirm → download CV + cover
  // letter → only then offer the link to the posting.
  const [applyItem, setApplyItem] = useState<BatchItem | null>(null);
  const [applyStage, setApplyStage] = useState<"confirm" | "downloading" | "ready">("confirm");

  function openApplyModal(item: BatchItem) {
    setApplyItem(item);
    setApplyStage("confirm");
  }

  function closeApplyModal() {
    setApplyItem(null);
  }

  async function confirmApplyDownload() {
    if (!applyItem) return;
    setApplyStage("downloading");
    try {
      await downloadCVAndCoverLetter(applyItem);
    } finally {
      setApplyStage("ready");
    }
  }

  function goToPosting() {
    if (applyItem?.job.applyLink) window.open(applyItem.job.applyLink, "_blank", "noopener,noreferrer");
  }

  const selected = items.find((it) => it.job.id === selectedId) || null;
  const formatLabel =
    profile.cvFormat === "pdf" ? "PDF" : profile.cvFormat === "docx" ? "DOCX" : "PDF + DOCX";

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
          <Link
            href="/profile"
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
          >
            Profile & CV
          </Link>
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
        <p className="mt-3 max-w-l text-soft">
          One click searches VP-through-Team-Lead roles across Abu Dhabi and scores
          your fit against every vacancy instantly — pick any result and tailor a real
          CV + cover letter for that one role, truthfully, in a single AI call.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field
            label="Narrow by keyword (optional)"
            value={keyword}
            onChange={setKeyword}
            placeholder="e.g. Engineering, Finance, Procurement"
            onEnter={() => runSearch()}
          />
          <button
            onClick={() => runSearch()}
            disabled={searching}
            className="mt-auto rounded-lg bg-beacon px-6 py-3 font-medium text-ink transition hover:brightness-105 disabled:opacity-60"
          >
            {searching ? "Searching…" : "Find matches"}
          </button>
        </div>
        {sampleNote && (
          <p className="mt-3 font-mono text-xs text-soft/80">▹ {sampleNote}</p>
        )}
        {searching && (
          <div className="mt-3 flex items-center gap-3 font-mono text-xs text-soft">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-beacon" />
            </span>
            Searching Abu Dhabi vacancies across ~67 target titles…
          </div>
        )}
      </section>

      {/* Results */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Job list */}
        <div className="space-y-3">
          {!searched && <ListHint />}

          {searched && items.length > 0 && (
            <>
              <div className="flex items-center justify-between font-mono text-xs text-soft/70">
                <span>{fetchedAt ? `Updated ${timeAgo(fetchedAt)}` : ""}</span>
                <button
                  onClick={() => runSearch()}
                  disabled={searching}
                  className="text-soft transition hover:text-beacon disabled:opacity-50"
                >
                  ↻ Refresh listings
                </button>
              </div>
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
            </>
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
                  setActionError(null);
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
            formatLabel={formatLabel}
            tab={tab}
            setTab={setTab}
            copy={copy}
            copied={copied}
            busy={busy}
            actionError={actionError}
            onApply={openApplyModal}
            onTailor={tailorJob}
            onDownloadLetter={downloadCoverLetter}
          />
        </div>
      </section>

      {/* Employer directory drawer */}
      {showEmployers && <EmployerDirectory onClose={() => setShowEmployers(false)} />}

      {/* Apply flow: confirm → download CV + cover letter → go to posting */}
      {applyItem && (
        <ApplyModal
          item={applyItem}
          stage={applyStage}
          onConfirm={confirmApplyDownload}
          onGoToPosting={goToPosting}
          onClose={closeApplyModal}
          formatLabel={formatLabel}
        />
      )}

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
  formatLabel,
  tab,
  setTab,
  copy,
  copied,
  busy,
  actionError,
  onApply,
  onTailor,
  onDownloadLetter,
}: {
  item: BatchItem | null;
  profile: Profile;
  formatLabel: string;
  tab: "cv" | "letter";
  setTab: (t: "cv" | "letter") => void;
  copy: (t: string, label: string) => void;
  copied: string | null;
  busy: string | null;
  actionError: string | null;
  onApply: (item: BatchItem) => void;
  onTailor: (item: BatchItem) => void;
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
            <div className="d-none mb-4 rounded-lg border border-beacon/30 bg-beacon/10 px-3 py-2.5">
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
                  {busy === `letter:${job.id}` ? "Preparing…" : `Download (${formatLabel})`}
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

          {analysis.demo ? (
            <>
              <button
                onClick={() => onTailor(item)}
                disabled={busy === `tailor:${job.id}`}
                className="mt-4 inline-block rounded-lg bg-beacon px-5 py-2.5 text-sm font-medium text-ink transition hover:brightness-105 disabled:opacity-60"
              >
                {busy === `tailor:${job.id}` ? "Tailoring with Claude…" : "Tailor CV for this job"}
              </button>
              <p className="mt-2 font-mono text-[10px] text-soft/60">
                Runs one AI call to generate a precise, truthful CV, cover letter, and gap analysis
                for this specific role.
              </p>
            </>
          ) : (
            <>
              <button
                onClick={() => onApply(item)}
                className="mt-4 inline-block rounded-lg bg-beacon px-5 py-2.5 text-sm font-medium text-ink transition hover:brightness-105"
              >
                Apply with this CV ↗
              </button>
              <p className="mt-2 font-mono text-[10px] text-soft/60">
                Downloads a ready-to-attach CV + cover letter ({formatLabel}), then takes you to the posting.
              </p>
            </>
          )}
          {actionError && <p className="mt-2 text-xs text-weak">{actionError}</p>}
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

function ApplyModal({
  item,
  stage,
  onConfirm,
  onGoToPosting,
  onClose,
  formatLabel,
}: {
  item: BatchItem;
  stage: "confirm" | "downloading" | "ready";
  onConfirm: () => void;
  onGoToPosting: () => void;
  onClose: () => void;
  formatLabel: string;
}) {
  const { job } = item;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={stage === "downloading" ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-base font-semibold leading-snug text-bright">{job.title}</h3>
        <p className="text-sm text-soft">{job.company}</p>

        {stage === "confirm" && (
          <>
            <p className="mt-4 text-sm leading-relaxed text-soft">
              This downloads a tailored CV and cover letter ({formatLabel}) for this role. Once they're
              ready, you'll get a link to the posting to apply.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-line px-3.5 py-2 text-sm text-soft transition hover:text-bright"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="rounded-lg bg-beacon px-3.5 py-2 text-sm font-medium text-ink transition hover:brightness-105"
              >
                Download CV + Cover Letter
              </button>
            </div>
          </>
        )}

        {stage === "downloading" && (
          <div className="mt-5 flex items-center gap-3 text-soft">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-beacon" />
            </span>
            <p className="text-sm">Preparing your CV and cover letter…</p>
          </div>
        )}

        {stage === "ready" && (
          <>
            <p className="mt-4 text-sm leading-relaxed text-soft">
              Your CV and cover letter have been downloaded — check your Downloads folder. Ready to
              apply?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-line px-3.5 py-2 text-sm text-soft transition hover:text-bright"
              >
                Close
              </button>
              <button
                onClick={onGoToPosting}
                className="rounded-lg bg-beacon px-3.5 py-2 text-sm font-medium text-ink transition hover:brightness-105"
              >
                Go to job posting ↗
              </button>
            </div>
          </>
        )}
      </div>
    </div>
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

