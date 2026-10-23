// A free job source is one employer career site read through the public
// endpoint its own careers page calls (no API key, no login). Each source
// names the adapter that understands that platform plus its parameters.
export type FreeJobSource = {
  /** Stable slug, used in job ids. */
  id: string;
  /** Display name shown as the job's company. */
  employer: string;
} & (
  | { adapter: "greenhouse"; slug: string }
  | { adapter: "lever"; slug: string }
  | { adapter: "smartrecruiters"; companyId: string }
  | { adapter: "workday"; host: string; tenant: string; site: string; searchText?: string }
  | { adapter: "oracle"; host: string; site: string; keyword?: string }
  // Phenom People: `locale` is the "<region>/<lang>" part of its job URLs.
  | { adapter: "phenom"; host: string; locale: string }
  | { adapter: "workable"; account: string }
  // Eightfold careers sites (e.g. jobs.worley.com); `domain` is its tenant domain.
  | { adapter: "eightfold"; host: string; domain: string; query?: string }
  // SAP SuccessFactors career sites: jobs are discovered from sitemap.xml.
  | { adapter: "successfactors"; host: string }
);

/** A listing as returned by the platform, before our criteria are applied. */
export interface JobCandidate {
  externalId: string;
  title: string;
  location: string;
  applyLink: string;
  /** ISO date when the platform gives one, else null. */
  postedAt: string | null;
  /** Plain-text description when the list endpoint already includes it. */
  description?: string;
  /** The list gives no location (e.g. a sitemap); the detail call supplies it. */
  locationUnknown?: boolean;
}

/**
 * What an adapter's list() returns. `incomplete` is set when a paging limit
 * stopped it while the site still had more jobs, so the sync does not mistake
 * the jobs it never read for closed ones.
 */
export type CandidateList = JobCandidate[] & { incomplete?: boolean };

export interface FreeJobAdapter {
  list(source: FreeJobSource, signal: AbortSignal): Promise<CandidateList>;
  /** Only needed when `list` does not return descriptions. */
  hydrate?(
    source: FreeJobSource,
    candidate: JobCandidate,
    signal: AbortSignal
  ): Promise<{
    description: string;
    postedAt?: string | null;
    /** Corrects what the list could not know (sitemap-based sources). */
    location?: string;
    title?: string;
  }>;
}
