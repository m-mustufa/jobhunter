"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExperienceEntry, Profile } from "@/lib/types";
import { DEFAULT_PROFILE, sanitizeProfile } from "@/lib/profile";
import { DEFAULT_MASTER_CV, buildMasterCVMarkdown } from "@/lib/masterCV";
import { loadJSON, saveJSON, MASTER_CV_KEY, PROFILE_KEY } from "@/lib/persist";
import { TabBtn, TextField, TextAreaField, ListField, ConfirmDialog, Toast } from "@/app/components/ui";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [masterCV, setMasterCV] = useState(DEFAULT_MASTER_CV);
  const [tab, setTab] = useState<"profile" | "cv">("profile");
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  // Same hydrate-then-gate-on-`hydrated` pattern as app/page.tsx, so a
  // save effect firing on the very first (pre-hydration) render can't
  // clobber what's actually in storage.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setProfile(sanitizeProfile(loadJSON(PROFILE_KEY, DEFAULT_PROFILE)));
    setMasterCV(loadJSON(MASTER_CV_KEY, DEFAULT_MASTER_CV));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveJSON(PROFILE_KEY, profile);
  }, [profile, hydrated]);
  useEffect(() => {
    if (hydrated) saveJSON(MASTER_CV_KEY, masterCV);
  }, [masterCV, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Every Profile edit regenerates Master CV from it — the two can't
  // drift apart, which is the whole point of this page. Direct edits to
  // the Master CV tab (below) don't call this, so they aren't touched
  // unless Profile changes again.
  function updateProfile(next: Profile) {
    setProfile(next);
    setMasterCV(buildMasterCVMarkdown(next));
  }

  function updateField<K extends keyof Profile>(key: K, value: Profile[K]) {
    updateProfile({ ...profile, [key]: value });
  }

  function selectResumeFile(file: File) {
    if (profile.name.trim() || profile.summary.trim() || profile.experience.length) {
      setPendingImport(file); // ask before overwriting existing content
    } else {
      importResumeFile(file);
    }
  }

  async function importResumeFile(file: File) {
    setImporting(true);
    setDemoNotice(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch("/api/parse-resume", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) {
        setToast(data.error || "Could not read that file.");
        return;
      }
      updateProfile(data.profile as Profile);
      if (data.demo) {
        setDemoNotice(data.demoNote || "Only contact details could be extracted automatically.");
      } else {
        setToast("Profile updated from the uploaded CV.");
      }
    } catch {
      setToast("Could not reach the resume-parsing service.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-5 pb-24">
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
          Edit Summary, Skills, Experience, and Education here — every change regenerates
          your Master CV automatically, so the two never drift apart.
        </p>
      </section>

      <div className="flex gap-1 rounded-lg border border-line bg-ink p-1">
        <TabBtn active={tab === "profile"} onClick={() => setTab("profile")}>
          Profile
        </TabBtn>
        <TabBtn active={tab === "cv"} onClick={() => setTab("cv")}>
          Master CV
        </TabBtn>
      </div>

      {tab === "profile" ? (
        <div className="mt-5 space-y-6">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">
                Import from CV
              </span>
              <input
                type="file"
                accept=".pdf,.docx"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) selectResumeFile(f);
                  e.target.value = "";
                }}
                className="block w-full text-sm text-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-raised file:px-3 file:py-2 file:text-sm file:text-soft disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="mt-1 block text-xs text-soft/70">
                Upload a .pdf or .docx resume (e.g. LinkedIn's own "Save to PDF" export from
                your profile page) to prefill everything below.
              </span>
            </label>

            {importing && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-beacon/30 bg-beacon/10 px-4 py-3">
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-pulseDot rounded-full bg-beacon" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-beacon" />
                </span>
                <p className="text-sm font-medium text-beacon">Reading and extracting your resume…</p>
              </div>
            )}

            {demoNotice && !importing && (
              <div className="mt-4 rounded-lg border border-beacon/30 bg-beacon/10 px-4 py-3">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-beacon">
                  Limited extraction
                </div>
                <p className="mt-1 text-xs leading-relaxed text-soft">{demoNotice}</p>
              </div>
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
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-line bg-surface p-5">
          <p className="mb-3 text-sm text-soft">
            Generated from your Profile above. You can tweak it directly — edits here stick
            until you next change something in the Profile tab, which regenerates this text.
          </p>
          <textarea
            value={masterCV}
            onChange={(e) => setMasterCV(e.target.value)}
            rows={24}
            className="scroll-thin w-full resize-none rounded-lg border border-line bg-ink p-4 font-mono text-sm leading-relaxed text-bright/90 outline-none focus:border-beacon/60"
          />
        </div>
      )}

      {pendingImport && (
        <ConfirmDialog
          title="Replace your Profile?"
          message="This will overwrite your current Profile details — and regenerate your Master CV to match — with what's extracted from this file."
          confirmLabel="Replace"
          cancelLabel="Cancel"
          onConfirm={() => {
            importResumeFile(pendingImport);
            setPendingImport(null);
          }}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </main>
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
