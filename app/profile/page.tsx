"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ExperienceEntry, Profile } from "@/lib/types";
import { DEFAULT_PROFILE, sanitizeProfile } from "@/lib/profile";
import { DEFAULT_MASTER_CV, buildMasterCVMarkdown } from "@/lib/masterCV";
import {
  loadJSON,
  markSavedJobListingsCleared,
  saveJSON,
  MASTER_CV_KEY,
  PROFILE_KEY,
} from "@/lib/persist";
import { fetchStoredProfile, pushStoredProfile } from "@/lib/profileStore";
import { fileToDataUrl, resizeImageDataUrl } from "@/lib/image";
import { downloadSampleCV, PopupBlockedError } from "@/lib/cvActions";
import { TextField, TextAreaField, ListField, Toast } from "@/app/components/ui";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  // Still generated and persisted alongside Profile (lib/masterCV.ts) — it
  // backs the offline demo-mode fallback (lib/demoAnalysis.ts) when no
  // ANTHROPIC_API_KEY is configured — but real tailoring (buildPrompt in
  // lib/analyzeJob.ts) reads the structured fields below directly, never
  // this markdown. So there's no UI for it: editing it separately would
  // just be editing something tailoring doesn't use.
  const [masterCV, setMasterCV] = useState(DEFAULT_MASTER_CV);
  const [toast, setToast] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [clearListingsOpen, setClearListingsOpen] = useState(false);
  const [clearListingsConfirmation, setClearListingsConfirmation] = useState("");
  const [clearingListings, setClearingListings] = useState(false);
  const [clearListingsError, setClearListingsError] = useState<string | null>(null);

  // Server (Vercel Blob, via /api/profile) is now the source of truth — it
  // survives incognito windows and other browsers/devices, which
  // localStorage structurally can't. Load order: server first; if that's
  // empty/unreachable, fall back to this browser's local copy; if that's
  // empty too, DEFAULT_PROFILE. localStorage stays populated afterward
  // purely as a fast local cache/offline fallback, not the authority.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    (async () => {
      const remote = await fetchStoredProfile();
      if (remote) {
        setProfile(sanitizeProfile(remote.profile));
        setMasterCV(remote.masterCV);
      } else {
        setProfile(sanitizeProfile(loadJSON(PROFILE_KEY, DEFAULT_PROFILE)));
        setMasterCV(loadJSON(MASTER_CV_KEY, DEFAULT_MASTER_CV));
      }
      setHydrated(true);
    })();
  }, []);

  // Debounced so rapid edits (typing) coalesce into one save + one status
  // message instead of firing on every keystroke. Skips announcing the very
  // first run after hydration — that one is just re-saving what was just
  // loaded, not a real edit — but still performs it so a genuinely failed
  // write is caught immediately rather than only surfacing later. Saves to
  // both the server (durable) and localStorage (fast local cache); the
  // server outcome drives the status message since that's the copy that
  // actually needs to survive.
  const justHydratedRef = useRef(true);
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(async () => {
      saveJSON(PROFILE_KEY, profile);
      saveJSON(MASTER_CV_KEY, masterCV);
      const remoteOk = await pushStoredProfile({ profile, masterCV });

      if (justHydratedRef.current) {
        justHydratedRef.current = false;
        return;
      }
      if (remoteOk) {
        setSaveError(null);
        setToast("Saved");
      } else {
        setSaveError(
          "Couldn't save to the server — your changes are only in this browser for now and won't survive incognito/another device. Check your connection and Vercel Blob setup, then try editing again."
        );
      }
    }, 600);
    return () => clearTimeout(t);
  }, [profile, masterCV, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Every Profile edit regenerates the (UI-less, demo-mode-only) Master CV
  // markdown alongside it, so the persisted bundle stays consistent.
  function updateProfile(next: Profile) {
    setProfile(next);
    setMasterCV(buildMasterCVMarkdown(next));
  }

  function updateField<K extends keyof Profile>(key: K, value: Profile[K]) {
    updateProfile({ ...profile, [key]: value });
  }

  // Stores the raw file for preview/reference only — no AI call, no
  // structured-field extraction. Tailoring reads the fields below directly,
  // which this upload doesn't touch.
  async function selectResumeFile(file: File) {
    setResumeBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      updateField("resumeFile", { name: file.name, type: file.type, dataUrl });
      setToast("CV uploaded.");
    } catch {
      setToast("Could not read that file.");
    } finally {
      setResumeBusy(false);
    }
  }

  async function downloadSample() {
    setSampleBusy(true);
    try {
      await downloadSampleCV(profile);
    } catch (error) {
      console.error("Sample CV generation failed", error);
      setToast(error instanceof PopupBlockedError ? error.message : "Could not generate the sample CV. Try again.");
    } finally {
      setSampleBusy(false);
    }
  }

  async function selectPhotoFile(file: File) {
    setPhotoBusy(true);
    try {
      const raw = await fileToDataUrl(file);
      const resized = await resizeImageDataUrl(raw);
      updateField("photo", resized);
    } catch {
      setToast("Could not read that image.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function closeClearListingsDialog() {
    if (clearingListings) return;
    setClearListingsOpen(false);
    setClearListingsConfirmation("");
    setClearListingsError(null);
  }

  async function clearSavedListings() {
    if (clearListingsConfirmation !== "Confirm" || clearingListings) return;
    setClearingListings(true);
    setClearListingsError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: clearListingsConfirmation }),
      });
      const data = (await response.json().catch(() => null)) as
        | { note?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(data?.error || "Saved listings could not be cleared.");
      }

      const browserCleared = markSavedJobListingsCleared();
      setClearListingsOpen(false);
      setClearListingsConfirmation("");
      setToast(
        browserCleared
          ? data?.note || "Saved listings cleared. Click Refresh listings to fetch fresh jobs."
          : "Server listings were cleared, but this browser cache could not be removed. Click Refresh listings on the search page."
      );
    } catch (error) {
      setClearListingsError(
        error instanceof Error ? error.message : "Saved listings could not be cleared."
      );
    } finally {
      setClearingListings(false);
    }
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
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-beacon/80">Profile & CV</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-bright sm:text-3xl">
          Your resume, structured.
        </h1>
        <p className="mt-2 max-w-xl text-soft">
          Edit Summary, Skills, Experience, and Education here — this is what tailoring
          actually reads from for every generated CV.
        </p>
      </section>

      {!hydrated ? (
        // Gated on the async server fetch resolving — editing before this
        // completes and loses the race would otherwise get silently
        // overwritten the moment the (older) server copy arrives.
        <div className="mt-5 rounded-2xl border border-line bg-surface p-8 text-center text-soft">
          Loading your profile…
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="grid gap-5 sm:grid-cols-[auto_1fr_auto]">
              <div>
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
                  Photo
                </span>
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-ink">
                    {profile.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.photo} alt="Profile" className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-mono text-[10px] text-soft/50">None</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      title={profile.photo ? "Replace photo" : "Upload photo"}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-beacon/40 text-beacon transition hover:bg-beacon/10"
                    >
                      <span className="h-4 w-4">{photoBusy ? "…" : <PencilIcon />}</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={photoBusy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) selectPhotoFile(f);
                          e.target.value = "";
                        }}
                        className="hidden"
                      />
                    </label>
                    <button
                      onClick={() => updateField("photo", "")}
                      disabled={!profile.photo}
                      title="Remove photo"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-soft transition hover:border-weak/60 hover:text-weak disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="h-4 w-4">
                        <TrashIcon />
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
                  Import from CV
                </span>
                <div className="rounded-xl border border-dashed border-line px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-beacon/40 bg-beacon/10 px-3 py-2 text-sm font-medium text-beacon transition hover:bg-beacon/20">
                      <span className="h-4 w-4">{resumeBusy ? "…" : <UploadIcon />}</span>
                      Choose file
                    </span>
                    <span className="min-w-0 break-words text-sm text-soft/70">
                      {profile.resumeFile?.name || "No file chosen"}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx"
                      disabled={resumeBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) selectResumeFile(f);
                        e.target.value = "";
                      }}
                      className="sr-only"
                    />
                  </div>
                  <span className="mt-2 block text-xs text-soft/70">
                    .pdf or .docx (e.g. LinkedIn's "Save to PDF" export) — kept below for reference.
                  </span>
                </div>
              </label>

              <label className="block sm:w-60">
                <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
                  Download format
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft">
                    <FileIcon />
                  </span>
                  <select
                    value={profile.cvFormat}
                    onChange={(e) => updateField("cvFormat", e.target.value as Profile["cvFormat"])}
                    className="w-full rounded-lg border border-line bg-ink py-2.5 pl-10 pr-3.5 text-bright outline-none transition focus:border-beacon/60"
                  >
                    <option value="both">PDF + DOCX (both)</option>
                    <option value="pdf">PDF only</option>
                    <option value="docx">DOCX only</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={downloadSample}
                  disabled={sampleBusy}
                  className="mt-2 font-mono text-xs text-soft hover:text-beacon disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sampleBusy ? "Generating…" : "Download sample"}
                </button>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 d-none">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-bright">Uploaded CV</h2>
              {profile.resumeFile && (
                <button
                  onClick={() => updateField("resumeFile", null)}
                  className="font-mono text-xs text-soft transition hover:text-weak"
                >
                  Remove
                </button>
              )}
            </div>
            {!profile.resumeFile ? (
              <p className="mt-3 text-sm text-soft">No CV uploaded yet — use "Import from CV" above.</p>
            ) : profile.resumeFile.type === "application/pdf" ? (
              <iframe
                src={profile.resumeFile.dataUrl}
                title="Uploaded CV"
                className="mt-4 h-[600px] w-full rounded-lg border border-line bg-white"
              />
            ) : (
              <a
                href={profile.resumeFile.dataUrl}
                download={profile.resumeFile.name}
                className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-ink px-4 py-3 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
              >
                <span className="h-5 w-5 shrink-0">
                  <FileIcon />
                </span>
                <span className="min-w-0 flex-1 truncate">{profile.resumeFile.name}</span>
                <span className="shrink-0 font-mono text-xs text-soft/70">Download</span>
              </a>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-display text-sm font-semibold text-bright">Contact</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField label="Full name" value={profile.name} onChange={(v) => updateField("name", v)} />
              <TextField label="Title" value={profile.title} onChange={(v) => updateField("title", v)} />
              <TextField label="Location" value={profile.location} onChange={(v) => updateField("location", v)} />
              <TextField label="Email" value={profile.email} onChange={(v) => updateField("email", v)} />
              <TextField label="Phone" value={profile.phone} onChange={(v) => updateField("phone", v)} />
            </div>
            <div className="mt-4">
              <ListField
                label="Links"
                items={profile.links}
                onChange={(links) => updateField("links", links)}
                placeholder="linkedin.com/in/..."
                addLabel="+ Add link"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-display text-sm font-semibold text-bright">About</h2>
            <div className="mt-4">
              <TextAreaField
                label="Summary"
                value={profile.summary}
                onChange={(v) => updateField("summary", v)}
                rows={4}
                placeholder="2-4 sentences on who you are and what you're best at."
              />
            </div>
            <div className="mt-4">
              <ListField
                label="Skills"
                items={profile.skills}
                onChange={(skills) => updateField("skills", skills)}
                placeholder="e.g. React"
                addLabel="+ Add skill"
                pill
              />
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-display text-sm font-semibold text-bright">Experience</h2>
            <div className="mt-4">
              <ExperienceEditor
                entries={profile.experience}
                onChange={(experience) => updateField("experience", experience)}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-display text-sm font-semibold text-bright">Education</h2>
            <div className="mt-4">
              <ListField
                label="Education / earlier career"
                items={profile.education}
                onChange={(education) => updateField("education", education)}
                placeholder="e.g. B.Sc. Computer Science, XYZ University"
                addLabel="+ Add line"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-display text-sm font-semibold text-bright">Certifications & Languages</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ListField
                label="Certifications"
                items={profile.certifications}
                onChange={(certifications) => updateField("certifications", certifications)}
                placeholder="e.g. PMP, NEBOSH"
                addLabel="+ Add certification"
              />
              <ListField
                label="Languages"
                items={profile.languages}
                onChange={(languages) => updateField("languages", languages)}
                placeholder="e.g. Arabic (Fluent)"
                addLabel="+ Add language"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-weak/30 bg-surface p-5">
            <h2 className="font-display text-sm font-semibold text-bright">Saved listings</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-soft">
              Refresh listings adds newly found jobs at the front while older jobs remain available
              in pagination. Nothing is removed automatically. After clearing, return to search and
              click Refresh listings to fetch fresh jobs. LinkedIn live syncs are limited to once
              every 12 hours to protect API credits.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-soft/70">
              This removes only saved Hirebase and LinkedIn listings. Applied Jobs, your profile,
              CVs, and tailored documents are not affected.
            </p>
            <button
              type="button"
              onClick={() => {
                setClearListingsConfirmation("");
                setClearListingsError(null);
                setClearListingsOpen(true);
              }}
              className="mt-4 rounded-lg border border-weak/50 bg-weak/10 px-4 py-2.5 text-sm font-medium text-weak transition hover:bg-weak/20"
            >
              Clear saved listings
            </button>
          </div>
        </div>
      )}

      {clearListingsOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeClearListingsDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-listings-title"
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/60"
          >
            <h2 id="clear-listings-title" className="font-display text-lg font-semibold text-bright">
              Clear saved listings?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-soft">
              All saved Hirebase and LinkedIn listings will be removed. Applied Jobs and CV data
              will stay unchanged. Clearing does not bypass the LinkedIn 12-hour credit cooldown.
              Type <span className="font-semibold text-bright">Confirm</span> to continue.
            </p>
            <input
              autoFocus
              value={clearListingsConfirmation}
              onChange={(event) => setClearListingsConfirmation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void clearSavedListings();
                if (event.key === "Escape") closeClearListingsDialog();
              }}
              placeholder="Confirm"
              aria-label="Type Confirm to clear saved listings"
              disabled={clearingListings}
              className="mt-5 w-full rounded-lg border border-line bg-ink px-3.5 py-3 text-bright outline-none transition placeholder:text-soft/40 focus:border-weak/70 disabled:opacity-60"
            />
            {clearListingsError && (
              <p className="mt-3 text-sm text-weak">{clearListingsError}</p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeClearListingsDialog}
                disabled={clearingListings}
                className="rounded-lg border border-line px-4 py-2.5 text-sm text-soft transition hover:text-bright disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void clearSavedListings()}
                disabled={clearListingsConfirmation !== "Confirm" || clearingListings}
                className="rounded-lg bg-weak px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {clearingListings ? "Clearing…" : "Clear saved listings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {saveError && (
        <div className="fixed bottom-20 right-5 z-[70] max-w-sm animate-fadeIn rounded-lg border border-weak/40 bg-weak/10 px-4 py-3 shadow-lg shadow-black/40">
          <div className="flex items-start gap-3">
            <p className="text-sm leading-relaxed text-weak">{saveError}</p>
            <button
              onClick={() => setSaveError(null)}
              className="shrink-0 text-weak/80 transition hover:text-weak"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
    >
      {children}
    </svg>
  );
}

function PencilIcon() {
  return (
    <Icon>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

function UploadIcon() {
  return (
    <Icon>
      <path d="M12 3v12" />
      <path d="M7 8l5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  );
}

function FileIcon() {
  return (
    <Icon>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </Icon>
  );
}

function ExperienceEditor({
  entries,
  onChange,
}: {
  entries: ExperienceEntry[];
  onChange: (entries: ExperienceEntry[]) => void;
}) {
  function updateEntry(i: number, patch: Partial<ExperienceEntry>) {
    const next = [...entries];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  function removeEntry(i: number) {
    onChange(entries.filter((_, idx) => idx !== i));
  }

  function addEntry() {
    onChange([...entries, { company: "", role: "", dates: "", bullets: [] }]);
  }

  return (
    <div className="space-y-4">
      {entries.map((entry, i) => (
        <div key={i} className="rounded-lg border border-line bg-ink/40 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-soft/70">Role {i + 1}</span>
            <button onClick={() => removeEntry(i)} className="text-xs text-soft transition hover:text-weak">
              Remove
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <TextField label="Company" value={entry.company} onChange={(v) => updateEntry(i, { company: v })} />
            <TextField label="Role" value={entry.role} onChange={(v) => updateEntry(i, { role: v })} />
          </div>
          <div className="mt-2">
            <TextField
              label="Dates"
              value={entry.dates}
              onChange={(v) => updateEntry(i, { dates: v })}
              placeholder="e.g. 2021–present"
            />
          </div>
          <div className="mt-3">
            <ListField
              label="Bullets"
              items={entry.bullets}
              onChange={(bullets) => updateEntry(i, { bullets })}
              placeholder="An achievement or responsibility"
              addLabel="+ Add bullet"
            />
          </div>
        </div>
      ))}
      <button onClick={addEntry} className="font-mono text-xs text-soft transition hover:text-beacon">
        + Add role
      </button>
    </div>
  );
}
