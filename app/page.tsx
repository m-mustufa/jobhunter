"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Analysis, BatchItem, Job, JobsResponse, Profile, TailoredCVContent } from "@/lib/types";
import { DEFAULT_MASTER_CV } from "@/lib/masterCV";
import { DEFAULT_PROFILE, sanitizeProfile } from "@/lib/profile";
import { getJobRecommendation } from "@/lib/jobRecommendation";
import { getEmployerPriority, getJobFreshnessRank } from "@/lib/employerPriority";
import { FUNCTIONAL_DOMAINS, matchFunctionalDomain, matchTargetTitle } from "@/lib/targetRoles";
import {
  loadJSON,
  removeJSON,
  saveJSON,
  MASTER_CV_KEY,
  PROFILE_KEY,
  JOBS_CACHE_KEY,
  LINKEDIN_JOBS_CACHE_KEY,
  JOB_LISTINGS_CLEARED_KEY,
  TAILORED_ANALYSES_KEY,
} from "@/lib/persist";
import { fetchStoredProfile } from "@/lib/profileStore";
import { serializeCVText } from "@/lib/cvDocument";
import { downloadCV as downloadCVAction, downloadCoverLetter as downloadCoverLetterAction, PopupBlockedError } from "@/lib/cvActions";
import { markJobApplied } from "@/lib/appliedJobs";
import { TabBtn } from "@/app/components/ui";
import { A4DocumentPreview } from "@/app/components/A4DocumentPreview";

const PAGE_SIZE = 10;
const OTHER = "Other";

interface JobsCache {
  jobs: Job[];
  fetchedAt: number;
  keyword: string;
  sampleNote: string | null;
}

// State for the free Claude handoff: fetch the same prompt the paid path
// would send (no API call), open it prefilled in Claude Desktop, then import
// the reply. Building and importing remain independent so either step can be
// retried without losing the other's state.
interface FreeTailorState {
  item: BatchItem;
  promptLoading: boolean;
  prompt: string;
  promptError: string | null;
  clipboardError: string | null;
  pasteText: string;
  // Bumped whenever `pasteText` is set from outside normal typing (clipboard
  // paste, a correction reset) — used as part of FreeTailorModal's `key` so
  // it remounts and re-seeds its local textarea state instead of the parent
  // needing to control every keystroke (see submitFreeTailorPaste).
  pasteResetToken: number;
  importing: boolean;
  importError: string | null;
  copied: boolean;
  // True right after a failed import replaces `prompt` with an
  // auto-generated corrected version — drives the modal auto-scrolling
  // back to step 1 and flagging it clearly, so the client can self-serve
  // the fix instead of having to ask what changed.
  hasCorrection: boolean;
}

interface SavedTailoredAnalysis {
  jobSignature: string;
  analysis: Analysis;
  tailoredAt: number;
}

interface TailoredAnalysisCache {
  version: number;
  profileSignature: string;
  entries: Record<string, SavedTailoredAnalysis>;
}

const TAILORED_ANALYSIS_CACHE_VERSION = 2;
const MAX_SAVED_ANALYSES = 30;

const EMPLOYER_TIER_RANK = {
  "government-gre": 4,
  "large-established": 3,
  established: 2,
  other: 1,
} as const;

function createAnalysisSignature(value: unknown): string {
  return JSON.stringify(value);
}

function getProfileAnalysisSignature(profile: Profile): string {
  return createAnalysisSignature({
    name: profile.name,
    title: profile.title,
    location: profile.location,
    summary: profile.summary,
    skills: profile.skills,
    experience: profile.experience,
    education: profile.education,
    certifications: profile.certifications,
    languages: profile.languages,
  });
}

function getJobAnalysisSignature(job: Job): string {
  return createAnalysisSignature({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
  });
}

function isUsableSavedAnalysis(value: unknown): value is SavedTailoredAnalysis {
  const saved = value as SavedTailoredAnalysis | undefined;
  const analysis = saved?.analysis;
  return Boolean(
    saved &&
      typeof saved.jobSignature === "string" &&
      Number.isFinite(saved.tailoredAt) &&
      analysis &&
      Number.isFinite(analysis.score) &&
      typeof analysis.tier === "string" &&
      typeof analysis.tierLabel === "string" &&
      typeof analysis.verdict === "string" &&
      Array.isArray(analysis.reasons) &&
      typeof analysis.tailoredCV?.summary === "string" &&
      Array.isArray(analysis.tailoredCV?.skills) &&
      Array.isArray(analysis.tailoredCV?.experience) &&
      Array.isArray(analysis.tailoredCV?.education) &&
      typeof analysis.coverLetter === "string" &&
      Array.isArray(analysis.auditTrail)
  );
}

function getSavedAnalysisCache(): TailoredAnalysisCache | null {
  const saved = loadJSON<unknown>(TAILORED_ANALYSES_KEY, null);
  if (!saved || typeof saved !== "object") return null;

  const cache = saved as TailoredAnalysisCache;
  if (
    cache.version !== TAILORED_ANALYSIS_CACHE_VERSION ||
    typeof cache.profileSignature !== "string" ||
    !cache.entries ||
    typeof cache.entries !== "object" ||
    Array.isArray(cache.entries)
  ) {
    return null;
  }
  return cache;
}

// No automatic AI scoring — every job starts unanalyzed until the user
// explicitly clicks "Tailor CV for this job". The lightweight Recommended
// marker is calculated separately and locally from the saved profile.
function toBatchItems(jobs: Job[], profile: Profile): BatchItem[] {
  const profileSignature = getProfileAnalysisSignature(profile);
  const savedCache = getSavedAnalysisCache();
  const savedAnalyses =
    savedCache?.profileSignature === profileSignature ? savedCache.entries : {};

  const items = jobs.map((job) => {
    const saved = savedAnalyses[job.id];
    if (
      isUsableSavedAnalysis(saved) &&
      saved.jobSignature === getJobAnalysisSignature(job)
    ) {
      return {
        job,
        analysis: saved.analysis,
        tailoredAt: saved.tailoredAt,
        status: "done" as const,
      };
    }
    return { job, status: "pending" as const };
  });

  return rankBatchItems(items, profile);
}

function postedTimestamp(value: string | null, now: number): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;

  const normalized = value.trim().toLowerCase();
  if (normalized === "just now" || normalized === "today") return now;
  if (normalized === "yesterday") return now - 86_400_000;

  const relative = normalized.match(
    /(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/
  );
  if (!relative) return 0;
  const unitMs: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };
  return now - Number(relative[1]) * unitMs[relative[2]];
}

function rankBatchItems(
  items: BatchItem[],
  profile: Profile,
  cachedRecommendations?: Map<string, ReturnType<typeof getJobRecommendation>>
): BatchItem[] {
  const recommendations =
    cachedRecommendations ||
    new Map(
      items.map((item) => [item.job.id, getJobRecommendation(profile, item.job)] as const)
    );
  const now = Date.now();

  return [...items].sort((a, b) => {
    const freshnessDifference =
      getJobFreshnessRank(b.job, now) - getJobFreshnessRank(a.job, now);
    if (freshnessDifference) return freshnessDifference;

    const employerTierDifference =
      EMPLOYER_TIER_RANK[getEmployerPriority(b.job).tier] -
      EMPLOYER_TIER_RANK[getEmployerPriority(a.job).tier];
    if (employerTierDifference) return employerTierDifference;

    const recommendationA = recommendations.get(a.job.id);
    const recommendationB = recommendations.get(b.job.id);
    const recommendedDifference =
      Number(recommendationB?.recommended === true) -
      Number(recommendationA?.recommended === true);
    if (recommendedDifference) return recommendedDifference;

    const recommendationScoreDifference =
      (recommendationB?.score || 0) - (recommendationA?.score || 0);
    if (recommendationScoreDifference) return recommendationScoreDifference;

    const recencyDifference =
      postedTimestamp(b.job.postedAt, now) - postedTimestamp(a.job.postedAt, now);
    if (recencyDifference) return recencyDifference;

    return (
      a.job.company.localeCompare(b.job.company) ||
      a.job.title.localeCompare(b.job.title) ||
      a.job.id.localeCompare(b.job.id)
    );
  });
}

// Pure reverse-chronological order, bypassing the curated employer-tier/
// recommendation ranking above. Undated listings (no parseable postedAt)
// always sink to the bottom instead of sorting as if posted in 1970.
function sortItemsByPostedDate(items: BatchItem[]): BatchItem[] {
  const now = Date.now();
  return [...items].sort((a, b) => {
    const aTime = postedTimestamp(a.job.postedAt, now);
    const bTime = postedTimestamp(b.job.postedAt, now);
    if (aTime === 0 || bTime === 0) {
      if (aTime === bTime) return 0;
      return aTime === 0 ? 1 : -1;
    }
    return bTime - aTime;
  });
}

function saveTailoredAnalysis(
  job: Job,
  profile: Profile,
  analysis: Analysis,
  tailoredAt: number
) {
  const profileSignature = getProfileAnalysisSignature(profile);
  const savedCache = getSavedAnalysisCache();
  const existingEntries =
    savedCache?.profileSignature === profileSignature ? savedCache.entries : {};
  const nextEntries: Record<string, SavedTailoredAnalysis> = {
    ...existingEntries,
    [job.id]: {
      jobSignature: getJobAnalysisSignature(job),
      analysis,
      tailoredAt,
    },
  };
  const recentEntries = Object.entries(nextEntries)
    .filter((entry): entry is [string, SavedTailoredAnalysis] =>
      isUsableSavedAnalysis(entry[1])
    )
    .sort(([, a], [, b]) => b.tailoredAt - a.tailoredAt)
    .slice(0, MAX_SAVED_ANALYSES);
  saveJSON(TAILORED_ANALYSES_KEY, {
    version: TAILORED_ANALYSIS_CACHE_VERSION,
    profileSignature,
    entries: Object.fromEntries(recentEntries),
  } satisfies TailoredAnalysisCache);
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

function formatPostedTime(value: string): string {
  const label = value.trim();
  if (!label) return "";
  // LinkedIn already supplies a useful signed-out relative label.
  if (/\bago\b/i.test(label) || /^(just now|today|yesterday)$/i.test(label)) return label;

  const timestamp = Date.parse(label);
  if (!Number.isFinite(timestamp)) return label;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function needsLinkedInDescription(job: Job): boolean {
  return (
    job.source === "LinkedIn" &&
    /^linkedin-\d+$/.test(job.id) &&
    job.description.includes("full description will be loaded before tailoring")
  );
}

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [listingsCleared, setListingsCleared] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"cv" | "letter">("cv");

  const [titleFilter, setTitleFilter] = useState("all");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [linkedinOnly, setLinkedinOnly] = useState(false);
  const [sortNewestFirst, setSortNewestFirst] = useState(false);
  const [keywordSearchOpen, setKeywordSearchOpen] = useState(false);
  const [page, setPage] = useState(1);

  const [masterCV, setMasterCV] = useState(DEFAULT_MASTER_CV);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // e.g. "letter:<jobId>" | "tailor:<jobId>"
  const [actionError, setActionError] = useState<string | null>(null);
  const [applyItem, setApplyItem] = useState<BatchItem | null>(null);
  const [freeTailor, setFreeTailor] = useState<FreeTailorState | null>(null);
  const pageRootRef = useRef<HTMLElement | null>(null);
  const jobsRequestRef = useRef<AbortController | null>(null);
  const jobsRequestIdRef = useRef(0);
  const tailoringBusy = busy?.startsWith("tailor:") === true;

  // The Claude call is intentionally modal: prevent scrolling, pointer
  // interaction, and keyboard focus from reaching the page until it ends.
  useEffect(() => {
    if (!tailoringBusy) return;

    const pageRoot = pageRootRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    pageRoot?.setAttribute("inert", "");
    pageRoot?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      pageRoot?.removeAttribute("inert");
      pageRoot?.removeAttribute("aria-hidden");
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [tailoringBusy]);

  // Hydrate persisted Master CV / Profile after mount (kept out of the
  // initial useState so server- and first-client-render markup match), then
  // either restore the last fetched job list from cache (instant, free) or
  // run a first search if nothing's cached yet.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    (async () => {
      // Server (Vercel Blob) first — the durable copy that survives
      // incognito/other browsers/devices; local storage is only a
      // fallback for when the server copy is empty or unreachable.
      const remote = await fetchStoredProfile();
      const mCV = remote ? remote.masterCV : loadJSON(MASTER_CV_KEY, DEFAULT_MASTER_CV);
      const prof = remote ? sanitizeProfile(remote.profile) : sanitizeProfile(loadJSON(PROFILE_KEY, DEFAULT_PROFILE));
      setMasterCV(mCV);
      setProfile(prof);
      setHydrated(true);

      const cache = loadJSON<JobsCache | null>(JOBS_CACHE_KEY, null);
      if (cache && cache.jobs?.length) {
        if (cache.keyword) setKeyword(cache.keyword);
        setSampleNote(cache.sampleNote);
        setFetchedAt(cache.fetchedAt);
        setSearched(true);
        const scored = toBatchItems(cache.jobs, prof);
        setItemsSynced(scored);
        setSelectedId(scored[0]?.job.id ?? null);
      } else if (loadJSON<number | null>(JOB_LISTINGS_CLEARED_KEY, null)) {
        setSearched(true);
        setListingsCleared(true);
        setSampleNote(
          "Saved listings are empty. Click Refresh listings to fetch fresh jobs."
        );
      } else {
        runSearch(prof, false);
      }
    })();
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

  useEffect(() => {
    return () => jobsRequestRef.current?.abort();
  }, []);

  const itemsRef = useRef<BatchItem[]>([]);

  function setItemsSynced(next: BatchItem[]) {
    itemsRef.current = next;
    setItems(next);
  }

  function patchItem(jobId: string, patch: Partial<BatchItem>) {
    const next = itemsRef.current.map((it) => (it.job.id === jobId ? { ...it, ...patch } : it));
    setItemsSynced(next);
  }

  // Fetches jobs — every one starts unanalyzed; real, AI-tailored CVs/cover
  // letters and the saved analysis are generated per-job, on demand, only when
  // the user clicks "Tailor CV for this job" (see tailorJob below). Keeps
  // this to one fetch that both the initial load and "Refresh listings" call.
  async function runSearch(
    profileForCache = profile,
    linkedinMode = linkedinOnly,
    forceRefresh = false
  ) {
    // Clearing is an explicit empty state. Keyword searches and source
    // switches must not silently refill it; only the clearly labelled
    // Refresh listings action is allowed to fetch a fresh provider snapshot.
    if (
      !forceRefresh &&
      (listingsCleared || loadJSON<number | null>(JOB_LISTINGS_CLEARED_KEY, null))
    ) {
      setSearched(true);
      setSelectedId(null);
      setItemsSynced([]);
      setPage(1);
      setFetchedAt(null);
      setSampleNote(
        "Saved listings are empty. Click Refresh listings to fetch fresh jobs."
      );
      return;
    }

    jobsRequestRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++jobsRequestIdRef.current;
    jobsRequestRef.current = controller;

    setSearching(true);
    setSearched(true);
    setSelectedId(null);
    setItemsSynced([]);
    setFetchedAt(null);
    setActionError(null);
    setTitleFilter("all");
    setFieldFilter("all");
    setPage(1);

    let jobs: Job[] = [];
    let note: string | null = null;
    let providerSyncedAt: number | null = null;
    try {
      const params = new URLSearchParams();
      if (keyword) params.set("keyword", keyword);
      if (linkedinMode) params.set("source", "linkedin");
      if (forceRefresh) params.set("refresh", "1");
      const query = params.toString();
      const r = await fetch(`/api/jobs${query ? `?${query}` : ""}`, {
        signal: controller.signal,
      });
      const data = (await r.json().catch(() => null)) as JobsResponse | null;
      if (!data) throw new Error("The jobs service returned an invalid response.");
      if (!r.ok) {
        throw new Error(data.error || data.note || "Could not load jobs.");
      }
      jobs = data.jobs || [];
      providerSyncedAt =
        typeof data.providerSyncedAt === "number" &&
        Number.isFinite(data.providerSyncedAt)
          ? data.providerSyncedAt
          : null;
      if (linkedinMode && jobs.length > 0) {
        // A refreshed LinkedIn search intentionally contains lightweight
        // cards. Preserve descriptions that were already fetched on demand
        // so saved tailoring and the local cache remain useful.
        const previous = loadJSON<JobsCache | null>(LINKEDIN_JOBS_CACHE_KEY, null);
        const previousById = new Map(previous?.jobs?.map((job) => [job.id, job]) || []);
        jobs = jobs.map((job) => {
          const cachedJob = previousById.get(job.id);
          return needsLinkedInDescription(job) && cachedJob && !needsLinkedInDescription(cachedJob)
            ? { ...job, description: cachedJob.description }
            : job;
        });
      }
      note = data.note || (data.sample ? "Showing sample jobs." : null);
    } catch (error) {
      if (controller.signal.aborted || requestId !== jobsRequestIdRef.current) return;
      const cacheKey = linkedinMode ? LINKEDIN_JOBS_CACHE_KEY : JOBS_CACHE_KEY;
      const fallback = loadJSON<JobsCache | null>(cacheKey, null);
      if (fallback?.jobs?.length && fallback.keyword === keyword) {
        jobs = fallback.jobs;
        providerSyncedAt = fallback.fetchedAt;
        note = linkedinMode
          ? "LinkedIn sync could not be completed — showing your last saved results. Credit use for the failed attempt could not be confirmed."
          : "Could not refresh listings — showing your last saved results.";
      } else {
        note = error instanceof Error ? error.message : "Could not reach the jobs service.";
      }
    } finally {
      if (requestId === jobsRequestIdRef.current) {
        jobsRequestRef.current = null;
        setSearching(false);
      }
    }
    if (requestId !== jobsRequestIdRef.current) return;
    setSampleNote(note);

    setFetchedAt(providerSyncedAt);

    if (!jobs.length) return;

    removeJSON(JOB_LISTINGS_CLEARED_KEY);
    setListingsCleared(false);

    const scored = toBatchItems(jobs, profileForCache);
    setItemsSynced(scored);
    setSelectedId(scored[0]?.job.id ?? null);

    const cacheTimestamp = providerSyncedAt || Date.now();
    setFetchedAt(cacheTimestamp);
    saveJSON(linkedinMode ? LINKEDIN_JOBS_CACHE_KEY : JOBS_CACHE_KEY, {
      jobs,
      fetchedAt: cacheTimestamp,
      keyword,
      sampleNote: note,
    });
  }

  function toggleLinkedInJobs() {
    if (searching) return;
    const next = !linkedinOnly;
    setLinkedinOnly(next);
    void runSearch(profile, next);
  }

  function submitKeywordSearch() {
    if (searching) return;
    setKeywordSearchOpen(false);
    void runSearch(profile, linkedinOnly, false);
  }

  async function ensureLinkedInDescription(job: Job, signal?: AbortSignal): Promise<Job> {
    if (!needsLinkedInDescription(job)) return job;
    const jobId = job.id.replace(/^linkedin-/, "");
    const params = new URLSearchParams({ source: "linkedin", jobId });
    const response = await fetch(`/api/jobs?${params.toString()}`, { signal });
    const data = (await response.json().catch(() => null)) as
      | { description?: string; error?: string }
      | null;
    if (!response.ok || !data?.description) {
      throw new Error(
        data?.error || "The LinkedIn job description could not be loaded. Please try again shortly."
      );
    }

    const hydratedJob = { ...job, description: data.description };
    patchItem(job.id, { job: hydratedJob });

    const cache = loadJSON<JobsCache | null>(LINKEDIN_JOBS_CACHE_KEY, null);
    if (cache?.jobs?.length) {
      saveJSON(LINKEDIN_JOBS_CACHE_KEY, {
        ...cache,
        jobs: cache.jobs.map((cachedJob) =>
          cachedJob.id === job.id ? hydratedJob : cachedJob
        ),
      });
    }
    return hydratedJob;
  }

  // Runs the real, paid Claude call for exactly one job — only fired when
  // the user explicitly asks to tailor that specific vacancy, not for every
  // result in the list.
  async function tailorJob(item: BatchItem, rewriteExisting = false) {
    if (item.analysis && !rewriteExisting) {
      setSelectedId(item.job.id);
      setActionError(null);
      return;
    }

    const key = `tailor:${item.job.id}`;
    setBusy(key);
    setActionError(null);
    // fetch() has no built-in timeout — if the serverless function hangs or
    // is killed past its own maxDuration without a clean response, the
    // request would otherwise sit as pending forever and the button would
    // stay stuck on "Tailoring with Claude…" indefinitely.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      const hydratedJob = await ensureLinkedInDescription(item.job, controller.signal);
      const workingItem = hydratedJob === item.job ? item : { ...item, job: hydratedJob };
      // The photo can be a large base64 JPEG and is not used by Claude.
      // Preserve the Profile shape while keeping it out of the request body.
      const analysisProfile = { ...profile, photo: "" };
      const analysisJob = {
        id: hydratedJob.id,
        title: hydratedJob.title,
        company: hydratedJob.company,
        location: hydratedJob.location,
        description: hydratedJob.description,
      };
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: analysisJob, profile: analysisProfile }),
        signal: controller.signal,
      });
      const payload = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(payload?.error || "Tailoring failed — try again.");
      }
      const analysis = payload as Analysis;
      if (!analysis || analysis.demo) {
        throw new Error(
          analysis?.demoNote ||
            "Live tailoring was unavailable. Your existing preview was left unchanged."
        );
      }

      const tailoredAt = Date.now();
      const completedItem: BatchItem = {
        ...workingItem,
        analysis,
        tailoredAt,
        status: "done",
      };
      patchItem(item.job.id, { job: hydratedJob, analysis, tailoredAt, status: "done" });
      saveTailoredAnalysis(hydratedJob, profile, analysis, tailoredAt);
      setApplyItem(completedItem);
    } catch (e: any) {
      const message = e?.name === "AbortError" ? "Tailoring timed out — try again." : e?.message;
      setActionError(message || "Tailoring failed — try again.");
    } finally {
      clearTimeout(timeout);
      setBusy((b) => (b === key ? null : b));
    }
  }

  function patchFreeTailor(patch: Partial<FreeTailorState>) {
    setFreeTailor((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // Opens the free-tailoring modal and immediately fetches the prompt (a
  // parsing/formatting step only — /api/analyze/prompt never calls Claude,
  // so this is free and can't fail for cost/quota reasons).
  async function openFreeTailorModal(item: BatchItem) {
    if (item.analysis) {
      setSelectedId(item.job.id);
      return;
    }
    setFreeTailor({
      item,
      promptLoading: true,
      prompt: "",
      promptError: null,
      clipboardError: null,
      pasteText: "",
      pasteResetToken: 0,
      importing: false,
      importError: null,
      copied: false,
      hasCorrection: false,
    });
    try {
      const hydratedJob = await ensureLinkedInDescription(item.job);
      const hydratedItem = hydratedJob === item.job ? item : { ...item, job: hydratedJob };
      patchFreeTailor({ item: hydratedItem });
      const analysisProfile = { ...profile, photo: "" };
      const analysisJob = {
        id: hydratedJob.id,
        title: hydratedJob.title,
        company: hydratedJob.company,
        location: hydratedJob.location,
        description: hydratedJob.description,
      };
      const r = await fetch("/api/analyze/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: analysisJob, profile: analysisProfile }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || "Could not build the prompt.");
      patchFreeTailor({ promptLoading: false, prompt: data.prompt });
    } catch (e: any) {
      patchFreeTailor({
        promptLoading: false,
        promptError: e?.message || "Could not build the prompt — check your connection and try again.",
      });
    }
  }

  function closeFreeTailorModal() {
    setFreeTailor(null);
  }

  async function retryFreeTailorPrompt() {
    if (freeTailor) await openFreeTailorModal(freeTailor.item);
  }

  async function copyFreeTailorPrompt() {
    if (!freeTailor?.prompt) return;
    try {
      await navigator.clipboard.writeText(freeTailor.prompt);
      patchFreeTailor({ copied: true, clipboardError: null });
      setTimeout(() => patchFreeTailor({ copied: false }), 2000);
    } catch {
      patchFreeTailor({
        clipboardError: "Couldn't copy automatically — select the prompt above and copy it manually.",
      });
    }
  }

  function openClaudeDesktop() {
    const prompt = freeTailor?.prompt;
    if (!prompt) return;

    // Official Claude Desktop deep link. It opens a new chat with the prompt
    // filled in for the user to review and send; it does not auto-submit.
    window.location.href = `claude://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  }

  async function pasteFreeTailorReplyFromClipboard() {
    if (!freeTailor || freeTailor.importing) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        throw new Error("empty");
      }
      patchFreeTailor({
        pasteText: text,
        importError: null,
        pasteResetToken: freeTailor.pasteResetToken + 1,
      });
    } catch {
      patchFreeTailor({
        importError: "Couldn't read the clipboard — paste Claude's full reply manually.",
      });
    }
  }

  // Parses whatever the user pasted back and, on success, feeds it into the
  // exact same downstream path as a real API tailoring result (same cache,
  // same Apply modal, same CV template) — the free flow is indistinguishable
  // from the paid one from this point on.
  async function submitFreeTailorPaste(pasteText: string) {
    if (!freeTailor || !pasteText.trim() || freeTailor.importing) return;
    const { item } = freeTailor;
    patchFreeTailor({ importing: true, importError: null });
    try {
      const analysisProfile = { ...profile, photo: "" };
      const analysisJob = {
        id: item.job.id,
        title: item.job.title,
        company: item.job.company,
        location: item.job.location,
        description: item.job.description,
      };
      const r = await fetch("/api/analyze/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pasteText, profile: analysisProfile, job: analysisJob }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        const correctionPrompt =
          typeof data?.correctionPrompt === "string" ? data.correctionPrompt : "";
        patchFreeTailor({
          importing: false,
          importError: correctionPrompt
            ? data?.error || "That response needs one fix."
            : data?.error || "Could not import that response.",
          ...(correctionPrompt
            ? {
                prompt: correctionPrompt,
                promptError: null,
                pasteText: "",
                pasteResetToken: freeTailor.pasteResetToken + 1,
                copied: false,
                hasCorrection: true,
              }
            : { hasCorrection: false }),
        });
        return;
      }
      const analysis = data as Analysis;
      const tailoredAt = Date.now();
      const completedItem: BatchItem = { ...item, analysis, tailoredAt, status: "done" };
      patchItem(item.job.id, { analysis, tailoredAt, status: "done" });
      saveTailoredAnalysis(item.job, profile, analysis, tailoredAt);
      setApplyItem(completedItem);
      setFreeTailor(null);
    } catch (e: any) {
      patchFreeTailor({
        importing: false,
        importError:
          e?.message || "Could not import that response — check you pasted the full reply and try again.",
      });
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  // Respects the user's preferred download format and template (Profile →
  // CV Format / CV Template). Used by the apply modal's standalone "Resume"
  // button; actual generation logic lives in lib/cvActions.tsx so the
  // Applied Jobs page can re-download with the exact same code.
  async function downloadCV(item: BatchItem) {
    if (!item.analysis) return;
    const key = `resume:${item.job.id}`;
    setBusy(key);
    try {
      await downloadCVAction(profile, item);
    } catch (error) {
      console.error("Resume generation failed", error);
      setActionError(
        error instanceof PopupBlockedError ? error.message : "Could not generate the resume. Refresh the page and try again."
      );
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  async function downloadCoverLetter(item: BatchItem) {
    if (!item.analysis) return;
    const key = `letter:${item.job.id}`;
    setBusy(key);
    try {
      await downloadCoverLetterAction(profile, item);
    } catch (error) {
      console.error("Cover-letter generation failed", error);
      setActionError(
        error instanceof PopupBlockedError ? error.message : "Could not generate the cover letter. Refresh the page and try again."
      );
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  // "Apply with this CV" opens a modal with three independent actions —
  // download the resume, download the cover letter, and open the posting —
  // so the user can pick whichever they need instead of a forced sequence.
  function openApplyModal(item: BatchItem) {
    setApplyItem(item);
  }

  function closeApplyModal() {
    setApplyItem(null);
  }

  // Clicking through to the real posting is what counts as "applying" — no
  // separate manual step, so this also records it in the Applied Jobs list.
  function goToPosting() {
    if (!applyItem?.job.applyLink) return;
    window.open(applyItem.job.applyLink, "_blank", "noopener,noreferrer");
    markJobApplied(applyItem);
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

  const recommendations = useMemo(() => {
    return new Map(
      items.map((item) => [item.job.id, getJobRecommendation(profile, item.job)] as const)
    );
  }, [items, profile]);

  const filteredItems = useMemo(() => {
    const filtered = items.filter((item) => {
      const recommendation = recommendations.get(item.job.id);
      const titleOk =
        titleFilter === "all" ||
        (matchTargetTitle(item.job.title) || OTHER) === titleFilter;
      const fieldOk =
        fieldFilter === "all" ||
        (matchFunctionalDomain(item.job.title) || OTHER) === fieldFilter;
      const recommendedOk = !recommendedOnly || recommendation?.recommended === true;
      return titleOk && fieldOk && recommendedOk;
    });
    return sortNewestFirst
      ? sortItemsByPostedDate(filtered)
      : rankBatchItems(filtered, profile, recommendations);
  }, [items, profile, titleFilter, fieldFilter, recommendedOnly, recommendations, sortNewestFirst]);

  useEffect(() => {
    if (!recommendedOnly) return;
    if (selectedId && filteredItems.some((item) => item.job.id === selectedId)) return;
    setSelectedId(filteredItems[0]?.job.id || null);
    setTab("cv");
  }, [filteredItems, recommendedOnly, selectedId]);

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

  function toggleRecommendedOnly() {
    setRecommendedOnly((current) => !current);
    setPage(1);
  }

  function toggleSortNewestFirst() {
    setSortNewestFirst((current) => !current);
    setPage(1);
  }

  return (
    <>
      {tailoringBusy && <TailoringOverlay />}
      <main ref={pageRootRef} className="mx-auto max-w-7xl px-5 pb-24">
      {/* Header */}
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-1">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-beacon animate-pulseDot" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-beacon" />
          </span>
          <div>
            <div className="font-display text-xl font-semibold tracking-tight text-bright">
              Job<span className="text-beacon">Hunter</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/employers"
            prefetch={false}
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
          >
            Employers
          </Link>
          <Link
            href="/applied"
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
          >
            Applied Jobs
          </Link>
          <Link
            href="/profile"
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
          >
            Profile & CV
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mb-5">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-beacon/80">
          Live application agent
        </p>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-bright sm:text-4xl">
          Every open vacancy in Abu Dhabi. Tailored CVs for all of them.
        </h1>
        <p className="mt-3 max-w-l text-soft">
          One click searches VP-through-Team-Lead roles across Abu Dhabi, highlights
          recommended opportunities & tailors a real CV + cover letter for any role.
        </p>

      </section>

      {/* Compact search + filters command bar */}
      <section className="mb-5">
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/70 p-2 xl:flex-nowrap"
          data-testid="jobs-filter-grid"
        >
          {keywordSearchOpen ? (
            <div className="flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-beacon/60 bg-ink px-2.5 sm:w-[300px] sm:shrink-0">
              <SearchIcon />
              <input
                autoFocus
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitKeywordSearch();
                  if (event.key === "Escape") setKeywordSearchOpen(false);
                }}
                placeholder="Engineering, Finance…"
                aria-label="Search jobs by keyword"
                className="min-w-0 flex-1 bg-transparent text-sm text-bright outline-none placeholder:text-soft/45"
              />
              <button
                type="button"
                onClick={submitKeywordSearch}
                disabled={searching}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-beacon text-ink transition hover:brightness-105 disabled:opacity-50"
                aria-label="Find matching jobs"
                title="Find matching jobs"
              >
                <SearchIcon />
              </button>
              <button
                type="button"
                onClick={() => setKeywordSearchOpen(false)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-soft transition hover:bg-raised hover:text-bright"
                aria-label="Close keyword search"
                title="Close"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setKeywordSearchOpen(true)}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-ink text-soft transition hover:border-beacon/60 hover:text-beacon"
              aria-label="Search jobs by keyword"
              aria-expanded="false"
              title={keyword ? `Keyword: ${keyword}` : "Search by keyword"}
            >
              <SearchIcon />
              {keyword && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-beacon" />
              )}
            </button>
          )}

          <label className="min-w-[145px] flex-1 sm:flex-none">
            <span className="sr-only">Title</span>
            <select
              value={titleFilter}
              onChange={(event) => updateTitleFilter(event.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-ink px-3 text-sm text-bright outline-none transition focus:border-beacon/70 sm:w-[165px]"
              aria-label="Filter by title"
              title="Filter by title"
            >
              {[{ value: "all", label: "All titles" }, ...titleOptions.map((title) => ({ value: title, label: title }))].map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="min-w-[145px] flex-1 sm:flex-none">
            <span className="sr-only">Field</span>
            <select
              value={fieldFilter}
              onChange={(event) => updateFieldFilter(event.target.value)}
              className="h-11 w-full rounded-lg border border-line bg-ink px-3 text-sm text-bright outline-none transition focus:border-beacon/70 sm:w-[165px]"
              aria-label="Filter by field"
              title="Filter by field"
            >
              {[{ value: "all", label: "All fields" }, ...domainOptions.map((domain) => ({ value: domain, label: domain }))].map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="flex h-11 min-w-[170px] shrink-0 items-center justify-between gap-3 rounded-lg border border-line bg-ink px-3">
            <span className="text-sm font-medium leading-tight text-bright">
              Recommended only
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={recommendedOnly}
              aria-label="Recommended jobs only"
              data-testid="recommended-jobs-toggle"
              onClick={toggleRecommendedOnly}
              className={`relative h-6 w-10 shrink-0 rounded-full border transition ${
                recommendedOnly ? "border-good bg-good" : "border-line bg-raised"
              }`}
            >
              <span
                className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  recommendedOnly ? "translate-x-[19px]" : "translate-x-[3px]"
                }`}
              />
            </button>
          </div>

          <div className="flex h-11 min-w-[174px] shrink-0 items-center justify-between gap-3 rounded-lg border border-line bg-ink px-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight text-bright">LinkedIn only</span>
              <span className="block font-mono text-[9px] leading-tight text-soft/55">Past 30 days</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={linkedinOnly}
              aria-label="LinkedIn jobs only"
              data-testid="linkedin-jobs-toggle"
              disabled={searching}
              onClick={toggleLinkedInJobs}
              className={`relative h-6 w-10 shrink-0 rounded-full border transition ${
                linkedinOnly ? "border-[#0a66c2] bg-[#0a66c2]" : "border-line bg-raised"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span
                className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  linkedinOnly ? "translate-x-[19px]" : "translate-x-[3px]"
                }`}
              />
            </button>
          </div>

          <div className="flex h-11 min-w-[150px] shrink-0 items-center justify-between gap-3 rounded-lg border border-line bg-ink px-3">
            <span className="text-sm font-medium leading-tight text-bright">
              Sort: Newest
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={sortNewestFirst}
              aria-label="Sort by newest first"
              data-testid="sort-newest-toggle"
              onClick={toggleSortNewestFirst}
              className={`relative h-6 w-10 shrink-0 rounded-full border transition ${
                sortNewestFirst ? "border-good bg-good" : "border-line bg-raised"
              }`}
            >
              <span
                className={`absolute left-0 top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  sortNewestFirst ? "translate-x-[19px]" : "translate-x-[3px]"
                }`}
              />
            </button>
          </div>

          <div
            className="min-w-[180px] flex-1 truncate px-1 font-mono text-[11px] text-soft/70"
            title={sampleNote || undefined}
          >
            {searching ? (
              <span className="inline-flex items-center gap-2 text-soft">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-beacon/25 border-t-beacon" />
                {linkedinOnly ? "Syncing LinkedIn…" : "Searching jobs…"}
              </span>
            ) : (
              <>
                {fetchedAt
                  ? `${linkedinOnly ? "Last synced" : "Updated"} ${timeAgo(fetchedAt)}`
                  : "Ready"}
                {sampleNote ? ` · ${sampleNote}` : ""}
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => runSearch(profile, linkedinOnly, true)}
            disabled={searching}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-line bg-ink px-3.5 text-sm text-soft transition hover:border-beacon/60 hover:text-beacon disabled:opacity-50"
            title="Refresh listings"
          >
            <RefreshIcon />
            <span className="hidden xl:inline">Refresh</span>
          </button>
        </div>
      </section>

      {/* Results */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Job list */}
        <div className="space-y-3">
          {!searched && <ListHint />}

          {searched && !searching && filteredItems.length === 0 && (
            <div className="rounded-xl border border-line bg-surface p-6 text-soft">
              {items.length === 0
                ? listingsCleared
                  ? "No saved listings. Click Refresh listings to fetch fresh jobs."
                : linkedinOnly
                  ? "No LinkedIn listings posted in the past 30 days came back. Try a different keyword, clear it, or switch back to all listings."
                  : "No listings posted in the past 30 days came back. Try a different keyword or clear it to search everything."
                : recommendedOnly
                  ? "No recommended vacancies match the current filters."
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
                recommended={recommendations.get(item.job.id)?.recommended === true}
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
            onRewrite={(item) => tailorJob(item, true)}
            onFreeTailor={openFreeTailorModal}
            onDownloadLetter={downloadCoverLetter}
          />
        </div>
      </section>

      {/* Apply flow: download resume, download cover letter, open posting —
          three independent actions instead of a forced sequence */}
      {applyItem && (
        <ApplyModal
          item={applyItem}
          busy={busy}
          onDownloadResume={downloadCV}
          onDownloadCoverLetter={downloadCoverLetter}
          onGoToPosting={goToPosting}
          onClose={closeApplyModal}
          formatLabel={formatLabel}
        />
      )}

      {/* Free tailoring flow: build the same prompt the paid call would send,
          hand it to Claude Desktop, then paste the reply back in to finish. */}
      {freeTailor && (
        <FreeTailorModal
          key={`${freeTailor.item.job.id}-${freeTailor.pasteResetToken}`}
          state={freeTailor}
          onCopyPrompt={copyFreeTailorPrompt}
          onOpenClaudeDesktop={openClaudeDesktop}
          onRetryPrompt={retryFreeTailorPrompt}
          onPasteFromClipboard={pasteFreeTailorReplyFromClipboard}
          onSubmitPaste={submitFreeTailorPaste}
          onClose={closeFreeTailorModal}
        />
      )}

      <footer className="mt-16 border-t border-line pt-5 text-center font-mono text-xs text-soft/70">
        JobHunter — jobs via Hirebase or LinkedIn listings via TheirStack, tailoring via Claude.
      </footer>
      </main>
    </>
  );
}

/* ---------- components ---------- */

function TailoringOverlay() {
  return (
    <div
      className="fixed inset-0 z-[100] flex cursor-wait items-center justify-center bg-ink/85 p-5 backdrop-blur-sm"
      role="status"
      aria-live="assertive"
      aria-label="Tailoring CV with Claude"
    >
      <div className="flex min-w-[260px] flex-col items-center rounded-2xl border border-line bg-surface px-8 py-7 text-center shadow-2xl">
        <span
          className="h-10 w-10 animate-spin rounded-full border-4 border-beacon/20 border-t-beacon"
          aria-hidden="true"
        />
        <p className="mt-4 font-display text-base font-semibold text-bright">
          Tailoring with Claude…
        </p>
        <p className="mt-1 text-xs text-soft">Please wait while your CV is prepared.</p>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.5 9A7 7 0 0 0 6 6.5L4 9" />
      <path d="M5.5 15A7 7 0 0 0 18 17.5l2-2.5" />
    </svg>
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
        Refresh listings to pull open Abu Dhabi vacancies, see recommended roles first,
        and tailor a CV for any job you choose.
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
  item,
  active,
  recommended,
  onSelect,
}: {
  item: BatchItem;
  active: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  const { job, analysis } = item;
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
      </div>

      {(recommended || analysis || job.salary) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {recommended && (
            <span className="rounded-md border border-good/35 bg-good/10 px-2 py-0.5 font-mono text-xs text-good">
              Recommended
            </span>
          )}
          {analysis && (
            <span className="rounded-md border border-good/30 bg-good/10 px-2 py-0.5 font-mono text-xs text-good">
              CV tailored
            </span>
          )}
          {job.salary && (
            <span className="rounded-md border border-good/30 bg-good/10 px-2 py-0.5 font-mono text-xs text-good">
              {job.salary}
            </span>
          )}
        </div>
      )}

      {(job.source || job.postedAt || job.applyLink) && (
        <div
          className={`${recommended || analysis || job.salary ? "mt-2" : "mt-3"} flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-soft/70`}
          data-testid="job-card-meta"
        >
          {job.source && <span>{job.source}</span>}
          {job.postedAt && (
            <>
              {job.source && <span aria-hidden="true">·</span>}
              <span>Posted {formatPostedTime(job.postedAt)}</span>
            </>
          )}
          {job.applyLink && (
            <>
              {(job.source || job.postedAt) && <span aria-hidden="true">·</span>}
              <a
                href={job.applyLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-beacon/80 underline-offset-4 transition hover:text-bright hover:underline"
              >
                View posting ↗
              </a>
            </>
          )}
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
  onRewrite,
  onFreeTailor,
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
  onRewrite: (item: BatchItem) => void;
  onFreeTailor: (item: BatchItem) => void;
  onDownloadLetter: (item: BatchItem) => void;
}) {
  if (!item) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-line bg-surface p-8 text-center">
        <div className="font-mono text-xs uppercase tracking-[0.15em] text-soft/60">
          Select a vacancy
        </div>
        <p className="mt-3 max-w-xs text-soft">
          Pick any result on the left to tailor and preview its CV and cover letter.
        </p>
      </div>
    );
  }

  const { job, analysis } = item;
  const tailoring = busy === `tailor:${job.id}`;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
        Application documents
      </div>
      <h2 className="font-display text-lg font-semibold leading-snug text-bright">
        {job.title}
      </h2>
      <p className="text-sm text-soft">{job.company}</p>

      {!analysis && (
        <div className="mt-6">
          <p className="text-sm leading-relaxed text-soft">
            Tailor your CV and cover letter specifically for this vacancy.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => onTailor(item)}
              disabled={tailoring}
              aria-busy={tailoring}
              className="inline-flex items-center gap-2 rounded-lg bg-beacon px-5 py-2.5 text-sm font-medium text-ink transition hover:brightness-105 disabled:opacity-60"
            >
              {tailoring && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-ink/25 border-t-ink"
                  aria-hidden="true"
                />
              )}
              <span>
                {tailoring ? "Tailoring with Claude…" : "Tailor CV for this job"}
              </span>
            </button>
            <button
              onClick={() => onFreeTailor(item)}
              disabled={tailoring}
              className="inline-flex items-center rounded-lg border border-line bg-raised px-4 py-2.5 text-sm text-soft transition hover:border-beacon/60 hover:text-bright disabled:opacity-60"
            >
              Tailor for free via Claude Desktop ↗
            </button>
          </div>
          <p className="mt-2 font-mono text-[10px] text-soft/60">
            Runs one AI call to generate a precise, truthful CV, cover letter, and audit trail for
            this specific role.
          </p>
        </div>
      )}

      {analysis && (
        <div className="mt-5">
          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-good/30 bg-good/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-good">
                CV already tailored for this job
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-soft">
                Your saved CV and cover letter are shown below
                {Number.isFinite(item.tailoredAt)
                  ? ` · tailored ${timeAgo(item.tailoredAt as number)}`
                  : "."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRewrite(item)}
              disabled={tailoring}
              className="shrink-0 rounded-md border border-good/40 px-3 py-1.5 font-mono text-[11px] text-good transition hover:bg-good/10 disabled:cursor-wait disabled:opacity-60"
            >
              {tailoring ? "Rewriting…" : "Rewrite CV again"}
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-1 rounded-lg border border-line bg-ink p-1">
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
            <A4DocumentPreview
              variant={tab === "cv" ? "cv" : "cover-letter"}
              profile={profile}
              job={job}
              analysis={analysis}
            />
            <div className="d-none scroll-thin max-h-[420px] overflow-y-auto rounded-lg border border-line bg-ink p-4 text-sm leading-relaxed text-bright/90">
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
            className="mt-4 inline-block rounded-lg bg-beacon px-5 py-2.5 text-sm font-medium text-ink transition hover:brightness-105"
          >
            Apply with this CV ↗
          </button>
          <p className="mt-2 font-mono text-[10px] text-soft/60">
            Download your tailored resume, cover letter ({formatLabel}), and open the job posting.
          </p>
        </div>
      )}
      {actionError && <p className="mt-2 text-xs text-weak">{actionError}</p>}
    </div>
  );
}

function TailoredCVPreview({ cv }: { cv: TailoredCVContent }) {
  return (
    <div className="space-y-4">
      {cv.summary && (
        <details className="group rounded-lg border border-line bg-surface/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.15em] text-soft [&::-webkit-details-marker]:hidden">
            <span>Summary</span>
            <span
              className="text-sm leading-none transition-transform group-open:rotate-180"
              aria-hidden="true"
            >
             ⌄
            </span>
          </summary>
          <p className="px-3 pb-3">{cv.summary}</p>
        </details>
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

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function ApplyModal({
  item,
  busy,
  onDownloadResume,
  onDownloadCoverLetter,
  onGoToPosting,
  onClose,
  formatLabel,
}: {
  item: BatchItem;
  busy: string | null;
  onDownloadResume: (item: BatchItem) => void;
  onDownloadCoverLetter: (item: BatchItem) => void;
  onGoToPosting: () => void;
  onClose: () => void;
  formatLabel: string;
}) {
  const { job } = item;
  const resumeBusy = busy === `resume:${job.id}`;
  const letterBusy = busy === `letter:${job.id}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold leading-snug text-bright">{job.title}</h3>
            <p className="text-sm text-soft">{job.company}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-soft transition hover:text-bright"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-soft">
          Download the tailored resume and cover letter for this role, then open the posting to apply.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <button
            onClick={() => onDownloadResume(item)}
            disabled={resumeBusy}
            className="flex justify-center flex-row items-center gap-1.5 rounded-lg border border-line px-2 py-3 text-xs text-soft transition hover:border-beacon/60 hover:text-bright disabled:opacity-50"
          >
            {resumeBusy ? "Preparing…" : "Resume"}
            <DownloadIcon />
          </button>
          <button
            onClick={() => onDownloadCoverLetter(item)}
            disabled={letterBusy}
            className="flex justify-center flex-row items-center gap-1.5 rounded-lg border border-line px-2 py-3 text-xs text-soft transition hover:border-beacon/60 hover:text-bright disabled:opacity-50"
          >
            {letterBusy ? "Preparing…" : "Cover Letter"}
            <DownloadIcon />
          </button>
          <button
            onClick={onGoToPosting}
            disabled={!job.applyLink}
            className="flex justify-center flex-row items-center gap-1.5 rounded-lg bg-beacon px-2 py-3 text-xs font-medium text-ink transition hover:brightness-105 disabled:opacity-50"
          >
            Job Post
            <ExternalLinkIcon />
          </button>
        </div>
        <p className="mt-3 text-center font-mono text-[10px] text-soft/60">Downloads as {formatLabel}.</p>
      </div>
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`}
      aria-hidden="true"
    />
  );
}

function FreeTailorModal({
  state,
  onCopyPrompt,
  onOpenClaudeDesktop,
  onRetryPrompt,
  onPasteFromClipboard,
  onSubmitPaste,
  onClose,
}: {
  state: FreeTailorState;
  onCopyPrompt: () => void;
  onOpenClaudeDesktop: () => void;
  onRetryPrompt: () => void;
  onPasteFromClipboard: () => void;
  onSubmitPaste: (text: string) => void;
  onClose: () => void;
}) {
  const {
    item,
    promptLoading,
    prompt,
    promptError,
    clipboardError,
    pasteText,
    importing,
    importError,
    copied,
    hasCorrection,
  } = state;
  const { job } = item;
  // Local, not lifted to the parent on every keystroke — Home re-renders the
  // full job list and the selected job's A4 CV preview on any state change,
  // which made typing here noticeably janky (measured ~120ms+ per keydown).
  // The parent still owns `pasteText` as the seed value for resets (opening
  // fresh, a clipboard paste, a correction) — see `key` at the call site.
  const [localPasteText, setLocalPasteText] = useState(pasteText);
  const canSubmit = localPasteText.trim().length > 0 && !importing;

  // A failed import silently swaps in a corrected prompt up at step 1 while
  // the client's attention (and scroll position) is down at step 2 where
  // they just clicked Import — jump back to it so the fix is impossible to
  // miss instead of something they'd have to notice and scroll up for.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (hasCorrection) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [prompt, hasCorrection]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        ref={scrollRef}
        className="scroll-thin max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold leading-snug text-bright">{job.title}</h3>
            <p className="text-sm text-soft">{job.company}</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-soft transition hover:text-bright" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mt-2 text-xs text-soft/70 d-none">
          Free alternative to "Tailor CV for this job" — uses your own Claude account instead of this app's AI
          budget. Claude Desktop can open with the prompt already filled in.
        </p>

        {/* Step 1: hand the generated prompt to Claude */}
        <div className="mt-5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
            1. {hasCorrection ? "Send this UPDATED prompt to Claude" : "Send this prompt to Claude"}
          </div>

          {promptLoading && (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-ink/60 px-3 py-3 text-sm text-soft">
              <Spinner />
              Building the prompt from your profile…
            </div>
          )}

          {!promptLoading && promptError && (
            <div className="rounded-lg border border-weak/30 bg-weak/10 p-3 text-sm text-weak">
              {promptError}
              <button
                onClick={onRetryPrompt}
                className="ml-2 underline underline-offset-4 hover:text-weak/80"
              >
                Try again
              </button>
            </div>
          )}

          {!promptLoading && !promptError && prompt && (
            <>
              <textarea
                readOnly
                value={prompt}
                rows={6}
                className="scroll-thin w-full resize-none rounded-lg border border-line bg-ink px-3 py-2.5 font-mono text-xs leading-relaxed text-soft/80 outline-none"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={onCopyPrompt}
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright ${
                    hasCorrection ? "animate-flashHighlight" : ""
                  }`}
                >
                  <DownloadIcon />
                  {copied ? "Copied ✓" : hasCorrection ? "Copy updated prompt" : "Copy prompt"}
                </button>
                <button
                  onClick={onOpenClaudeDesktop}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-beacon px-3.5 py-2 text-sm font-medium text-ink transition hover:brightness-105"
                >
                  <ExternalLinkIcon />
                  Open in Claude Desktop
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-soft/60">
                Claude Desktop will open with the prompt filled in. Don&apos;t have it?{" "}
                <a
                  href="https://claude.com/download"
                  target="_blank"
                  rel="noreferrer"
                  className="text-beacon underline underline-offset-4 hover:text-beacon/80"
                >
                  Install Claude Desktop
                </a>
                .
              </p>
              {clipboardError && <p className="mt-2 text-sm text-weak">{clipboardError}</p>}
            </>
          )}
        </div>

        {/* Step 2: paste the reply back in */}
        <div className="mt-5">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
            2. Paste Claude's full reply here
          </div>
          <button
            onClick={onPasteFromClipboard}
            disabled={importing}
            className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright disabled:cursor-not-allowed disabled:opacity-50"
          >
            Paste reply from clipboard
          </button>
          <textarea
            value={localPasteText}
            onChange={(e) => setLocalPasteText(e.target.value)}
            disabled={importing}
            rows={6}
            placeholder="Paste everything Claude replied with, including the opening { and closing } — nothing else needed."
            className="scroll-thin w-full resize-none rounded-lg border border-line bg-ink px-3 py-2.5 text-sm leading-relaxed text-bright outline-none placeholder:text-soft/40 focus:border-beacon/60 disabled:opacity-60"
          />
          {importError && hasCorrection && (
            <button
              type="button"
              onClick={onCopyPrompt}
              className="mt-2 w-full rounded-lg border border-beacon/40 bg-beacon/10 px-3.5 py-3 text-left text-sm text-beacon transition hover:bg-beacon/20"
            >
              {copied
                ? "Copied ✓ — now open Claude, send it again, then paste the new reply in the box above."
                : "Needs one fix — click to copy the updated prompt above, send it to Claude again, then paste the new reply in the box above."}
            </button>
          )}
          {importError && !hasCorrection && <p className="mt-2 text-sm text-weak">{importError}</p>}
          <button
            onClick={() => onSubmitPaste(localPasteText)}
            disabled={!canSubmit}
            aria-busy={importing}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-beacon px-5 py-2.5 text-sm font-medium text-ink transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing && <Spinner className="border-ink/25 border-t-ink" />}
            {importing ? "Importing…" : "Import & generate CV"}
          </button>
        </div>
      </div>
    </div>
  );
}
