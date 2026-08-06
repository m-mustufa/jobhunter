"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmployerProfile, EmployersResponse } from "@/lib/employers";

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function companySize(employer: EmployerProfile): string | null {
  if (employer.sizeMin !== null && employer.sizeMax !== null) {
    return `${employer.sizeMin.toLocaleString()}–${employer.sizeMax.toLocaleString()} employees`;
  }
  if (employer.sizeMin !== null) return `${employer.sizeMin.toLocaleString()}+ employees`;
  if (employer.sizeMax !== null) return `Up to ${employer.sizeMax.toLocaleString()} employees`;
  return null;
}

export default function EmployersPage() {
  const [response, setResponse] = useState<EmployersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function loadEmployers(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const request = await fetch("/api/employers", {
        signal,
        cache: "no-store",
      });
      const payload = (await request.json().catch(() => null)) as EmployersResponse | null;
      if (!request.ok || !payload || !Array.isArray(payload.employers)) {
        throw new Error(payload?.error || "The employer directory returned an invalid response.");
      }
      setResponse(payload);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The employer directory could not be loaded."
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadEmployers(controller.signal);
    return () => controller.abort();
  }, []);

  const filteredEmployers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return response?.employers || [];
    return (response?.employers || []).filter((employer) =>
      [
        employer.name,
        employer.description,
        employer.jobBoard || "",
        ...employer.industries,
        ...employer.subindustries,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [query, response]);

  const groupedEmployers = useMemo(() => {
    const groups = new Map<string, EmployerProfile[]>();
    for (const employer of filteredEmployers) {
      const group = employer.industries[0] || "Other employers";
      const current = groups.get(group) || [];
      current.push(employer);
      groups.set(group, current);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEmployers]);

  return (
    <main className="mx-auto max-w-7xl px-5 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <Link href="/" className="flex items-center gap-1" aria-label="Back to JobHunter">
          <span className="h-2.5 w-2.5 rounded-full bg-beacon" />
          <span className="font-display text-lg font-semibold tracking-tight text-bright">
            Job<span className="text-beacon">Hunter</span>
          </span>
        </Link>
        <nav className="flex flex-wrap gap-2">
          <Link
            href="/"
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-sm text-soft transition hover:border-beacon/60 hover:text-bright"
          >
            Job listings
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
        </nav>
      </header>

      <section className="mb-6">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-beacon/80">
          Employer intelligence
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-bright sm:text-4xl">
          Abu Dhabi employer directory.
        </h1>
        <p className="mt-2 max-w-2xl text-soft">
          Browse up to 100 Abu Dhabi-headquartered company profiles. Hirebase is requested only
          when this page opens, then the saved directory is reused for 24 hours.
        </p>
      </section>

      <section className="mb-6 rounded-xl border border-line bg-surface/70 p-3">
        <div className="flex items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search employers</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company, industry, or technology"
              className="h-11 w-full rounded-lg border border-line bg-ink pl-10 pr-3 text-sm text-bright outline-none transition placeholder:text-soft/45 focus:border-beacon/70"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-soft/65">
          <span className="min-w-0 truncate" title={response?.note}>
            {loading
              ? "Loading employers from Hirebase…"
              : response
                ? `${response.note} Updated ${timeAgo(response.fetchedAt)}.`
                : error || "No employer data available."}
          </span>
          {!loading && response && (
            <span className="shrink-0">
              {filteredEmployers.length} of {response.employers.length} employers
            </span>
          )}
        </div>
      </section>

      {loading && !response ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="h-48 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : error && !response ? (
        <div className="rounded-xl border border-weak/35 bg-weak/10 p-6 text-weak">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadEmployers()}
            className="mt-3 rounded-lg border border-weak/40 px-3 py-1.5 text-sm transition hover:bg-weak/10"
          >
            Try again
          </button>
        </div>
      ) : groupedEmployers.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-soft">
          No employers match “{query}”.
        </div>
      ) : (
        <div className="space-y-8">
          {groupedEmployers.map(([industry, employers]) => (
            <section key={industry}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.15em] text-beacon/80">
                  {industry}
                </h2>
                <span className="h-px flex-1 bg-line" />
                <span className="font-mono text-[10px] text-soft/55">{employers.length}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {employers.map((employer) => {
                  const size = companySize(employer);
                  return (
                    <article
                      key={employer.id}
                      className="flex min-h-[190px] flex-col rounded-xl border border-line bg-surface p-4 transition hover:border-beacon/45"
                    >
                      <div className="flex items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-ink font-display text-sm font-semibold text-beacon">
                          {employer.logoUrl ? (
                            <img
                              src={employer.logoUrl}
                              alt=""
                              className="h-full w-full object-contain"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            employer.name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-display text-base font-semibold leading-snug text-bright">
                            {employer.name}
                          </h3>
                          {(size || employer.jobBoard) && (
                            <p className="mt-0.5 font-mono text-[10px] text-soft/60">
                              {[size, employer.jobBoard ? `Jobs via ${employer.jobBoard}` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>

                      <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-soft">
                        {employer.description}
                      </p>

                      {employer.subindustries.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {employer.subindustries.slice(0, 3).map((item) => (
                            <span
                              key={item}
                              className="rounded-md border border-line bg-ink px-2 py-0.5 text-[10px] text-soft/70"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-4 font-mono text-[11px]">
                        {employer.linkedinUrl && (
                          <a
                            href={employer.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-soft transition hover:text-beacon"
                          >
                            Company profile ↗
                          </a>
                        )}
                        {employer.websiteUrl && (
                          <a
                            href={employer.websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-soft transition hover:text-beacon"
                          >
                            Website ↗
                          </a>
                        )}
                        <a
                          href={employer.jobsSearchUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-beacon/85 transition hover:text-beacon"
                        >
                          LinkedIn jobs ↗
                        </a>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
