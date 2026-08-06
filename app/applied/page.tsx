"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppliedJobRecord, loadAppliedJobs, removeAppliedJob } from "@/lib/appliedJobs";
import { downloadCV, downloadCoverLetter, PopupBlockedError } from "@/lib/cvActions";
import { DEFAULT_PROFILE, sanitizeProfile } from "@/lib/profile";
import { loadJSON, PROFILE_KEY } from "@/lib/persist";
import { fetchStoredProfile } from "@/lib/profileStore";
import { BatchItem, Profile } from "@/lib/types";
import { ConfirmDialog, Toast } from "@/app/components/ui";

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

export default function AppliedJobsPage() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [applied, setApplied] = useState<AppliedJobRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setApplied(loadAppliedJobs());
    (async () => {
      const remote = await fetchStoredProfile();
      setProfile(sanitizeProfile(remote ? remote.profile : loadJSON(PROFILE_KEY, DEFAULT_PROFILE)));
      setHydrated(true);
    })();
  }, []);

  function toBatchItem(record: AppliedJobRecord): BatchItem {
    return {
      job: record.job,
      analysis: record.analysis,
      status: record.analysis ? "done" : "pending",
    };
  }

  async function handleDownloadCV(record: AppliedJobRecord) {
    const key = `resume:${record.job.id}`;
    setBusy(key);
    try {
      await downloadCV(profile, toBatchItem(record));
    } catch (error) {
      console.error("Resume generation failed", error);
      setActionError(
        error instanceof PopupBlockedError ? error.message : "Could not generate the resume. Refresh the page and try again."
      );
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  async function handleDownloadCoverLetter(record: AppliedJobRecord) {
    const key = `letter:${record.job.id}`;
    setBusy(key);
    try {
      await downloadCoverLetter(profile, toBatchItem(record));
    } catch (error) {
      console.error("Cover-letter generation failed", error);
      setActionError(
        error instanceof PopupBlockedError ? error.message : "Could not generate the cover letter. Refresh the page and try again."
      );
    } finally {
      setBusy((b) => (b === key ? null : b));
    }
  }

  function confirmRemove(jobId: string) {
    removeAppliedJob(jobId);
    setApplied(loadAppliedJobs());
    setPendingRemove(null);
    setToast("Removed from Applied Jobs.");
  }

  return (
    <main className="mx-auto max-w-7xl px-5 pb-24">
      <header className="flex items-center justify-between py-6">
        <Link
          href="/"
          className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
        >
          ← Back to search
        </Link>
      </header>

      <section className="mb-6">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-beacon/80">Applied Jobs</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-bright sm:text-3xl">
          Jobs you've applied to.
        </h1>
        <p className="mt-2 max-w-xl text-soft">
          Recorded automatically the moment you open a job posting from the Apply modal.
        </p>
      </section>

      {!hydrated ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-soft">Loading…</div>
      ) : applied.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center text-soft">
          No applied jobs yet — click "Job Post ↗" in the Apply modal after tailoring a CV and it'll show up here.
        </div>
      ) : (
        <div className="space-y-3">
          {applied.map((record) => {
            const cvKey = `resume:${record.job.id}`;
            const letterKey = `letter:${record.job.id}`;
            return (
              <div key={record.job.id} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-base font-semibold text-bright">{record.job.title}</h2>
                    <p className="mt-0.5 text-sm text-soft">
                      {record.job.company}
                      {record.job.location ? ` · ${record.job.location}` : ""}
                    </p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.15em] text-soft/70">
                      Applied {timeAgo(record.appliedAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => setPendingRemove(record.job.id)}
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-soft transition hover:border-weak/60 hover:text-weak"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {record.job.applyLink && (
                    <a
                      href={record.job.applyLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-beacon\/80 rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
                    >
                      View posting ↗
                    </a>
                  )}
                  {record.analysis && (
                    <>
                      <button
                        onClick={() => handleDownloadCV(record)}
                        disabled={busy === cvKey}
                        className="rounded-lg border border-beacon/40 bg-beacon/10 px-3.5 py-2 text-sm font-medium text-beacon transition hover:bg-beacon/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === cvKey ? "Generating…" : "Resume"}
                      </button>
                      <button
                        onClick={() => handleDownloadCoverLetter(record)}
                        disabled={busy === letterKey}
                        className="rounded-lg border border-beacon/40 bg-beacon/10 px-3.5 py-2 text-sm font-medium text-beacon transition hover:bg-beacon/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === letterKey ? "Generating…" : "Cover Letter"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {actionError && (
        <div className="fixed inset-x-0 bottom-0 z-[70] flex justify-center p-4">
          <div className="flex max-w-md items-start gap-3 rounded-lg border border-weak/40 bg-surface px-4 py-3 shadow-lg shadow-black/40">
            <p className="text-sm text-weak">{actionError}</p>
            <button
              onClick={() => setActionError(null)}
              className="shrink-0 text-soft transition hover:text-bright"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {pendingRemove && (
        <ConfirmDialog
          title="Remove from Applied Jobs?"
          message="This only removes it from this list — it won't affect the actual application."
          confirmLabel="Remove"
          cancelLabel="Cancel"
          onConfirm={() => confirmRemove(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </main>
  );
}
