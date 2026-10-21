import "server-only";

import { isRecent, MAX_JOB_AGE_DAYS } from "./criteria";
import { load } from "cheerio";
import { fetchJson, fetchText, htmlToText } from "./http";
import type { FreeJobAdapter, FreeJobSource, JobCandidate } from "./types";

type Source<A extends FreeJobSource["adapter"]> = Extract<FreeJobSource, { adapter: A }>;

const toIso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const time = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

// --- Greenhouse: one call returns every job with its full description. -----
const greenhouse: FreeJobAdapter = {
  async list(source, signal) {
    const { slug } = source as Source<"greenhouse">;
    const data = await fetchJson<{ jobs?: any[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
      signal
    );
    return (data.jobs || []).map((job): JobCandidate => ({
      externalId: String(job.id),
      title: String(job.title || ""),
      location: String(job.location?.name || ""),
      applyLink: String(job.absolute_url || ""),
      postedAt: toIso(job.first_published || job.updated_at),
      description: htmlToText(String(job.content || "")),
    }));
  },
};

// --- Lever: one call returns every posting with its full description. ------
const lever: FreeJobAdapter = {
  async list(source, signal) {
    const { slug } = source as Source<"lever">;
    const data = await fetchJson<any[]>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
      signal
    );
    return (Array.isArray(data) ? data : []).map((job): JobCandidate => {
      const lists = (job.lists || [])
        .map((list: any) => `${list.text || ""}\n${htmlToText(String(list.content || ""))}`)
        .join("\n\n");
      return {
        externalId: String(job.id),
        title: String(job.text || ""),
        location: String(job.categories?.location || job.country || ""),
        applyLink: String(job.hostedUrl || ""),
        postedAt: toIso(job.createdAt),
        // Some postings leave the *Plain fields empty and only fill the HTML
        // ones, so fall back to converting those.
        description: [
          job.descriptionPlain || htmlToText(String(job.description || "")),
          lists,
          job.additionalPlain || htmlToText(String(job.additional || "")),
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim(),
      };
    });
  },
};

// --- SmartRecruiters: list is light, the detail call has the description. --
const smartrecruiters: FreeJobAdapter = {
  async list(source, signal) {
    const { companyId } = source as Source<"smartrecruiters">;
    const candidates: JobCandidate[] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await fetchJson<{ content?: any[]; totalFound?: number }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings?limit=100&offset=${offset}&country=ae`,
        signal
      );
      for (const job of page.content || []) {
        candidates.push({
          externalId: String(job.id),
          title: String(job.name || ""),
          location: [job.location?.city, job.location?.country?.toUpperCase?.() === "AE" ? "UAE" : job.location?.country]
            .filter(Boolean)
            .join(", "),
          applyLink: `https://jobs.smartrecruiters.com/${encodeURIComponent(companyId)}/${job.id}`,
          postedAt: toIso(job.releasedDate),
        });
      }
      if (!page.content?.length || offset + 100 >= (page.totalFound || 0)) break;
    }
    return candidates;
  },
  async hydrate(source, candidate, signal) {
    const { companyId } = source as Source<"smartrecruiters">;
    const detail = await fetchJson<any>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings/${encodeURIComponent(candidate.externalId)}`,
      signal
    );
    const sections = detail.jobAd?.sections || {};
    const description = ["jobDescription", "qualifications", "additionalInformation"]
      .map((key) => htmlToText(String(sections[key]?.text || "")))
      .filter(Boolean)
      .join("\n\n");
    return { description };
  },
};

// --- Workday: POST search for the list, GET per job for the description. ---
function workdayPostedAt(text: unknown): string | null {
  const value = String(text || "").toLowerCase();
  const now = Date.now();
  if (/today/.test(value)) return new Date(now).toISOString();
  if (/yesterday/.test(value)) return new Date(now - 86_400_000).toISOString();
  const match = value.match(/(\d+)\+?\s+days?/);
  // "30+ Days Ago" is an open-ended bucket. Inside a 30-day window it is
  // simply too old; with a wider window the exact date is unknown, so leave
  // it open and let the detail call's start date decide.
  if (match && value.includes("+")) {
    return MAX_JOB_AGE_DAYS > 30 ? null : new Date(now - 31 * 86_400_000).toISOString();
  }
  return match ? new Date(now - Number(match[1]) * 86_400_000).toISOString() : null;
}

const workday: FreeJobAdapter = {
  async list(source, signal) {
    const { host, tenant, site, searchText } = source as Source<"workday">;
    const base = `https://${host}/wday/cxs/${tenant}/${site}`;
    const candidates: JobCandidate[] = [];
    // Workday only reports `total` on the first page (later pages say 0), so
    // keep the first page's value instead of trusting each response.
    let total = 0;
    for (let offset = 0; offset < 200; offset += 20) {
      const page = await fetchJson<{ jobPostings?: any[]; total?: number }>(
        `${base}/jobs`,
        signal,
        {
          method: "POST",
          body: { appliedFacets: {}, limit: 20, offset, searchText: searchText || "" },
        }
      );
      if (offset === 0) total = page.total || 0;
      for (const job of page.jobPostings || []) {
        if (!job.externalPath) continue;
        candidates.push({
          externalId: String(job.externalPath),
          title: String(job.title || ""),
          location: String(job.locationsText || ""),
          applyLink: `https://${host}/${site}${job.externalPath}`,
          postedAt: workdayPostedAt(job.postedOn),
        });
      }
      if (!page.jobPostings?.length || offset + 20 >= total) break;
    }
    return candidates;
  },
  async hydrate(source, candidate, signal) {
    const { host, tenant, site } = source as Source<"workday">;
    const detail = await fetchJson<{ jobPostingInfo?: any }>(
      `https://${host}/wday/cxs/${tenant}/${site}${candidate.externalId}`,
      signal
    );
    const info = detail.jobPostingInfo || {};
    return {
      description: htmlToText(String(info.jobDescription || "")),
      postedAt: toIso(info.startDate) || candidate.postedAt,
    };
  },
};

// --- Oracle Recruiting Cloud: the REST API behind its Candidate Experience. -
const oracle: FreeJobAdapter = {
  async list(source, signal) {
    const { host, site, keyword } = source as Source<"oracle">;
    const candidates: JobCandidate[] = [];
    for (let offset = 0; offset < 200; offset += 25) {
      const finder = `findReqs;siteNumber=${site},limit=25,offset=${offset}${keyword ? `,keyword=${encodeURIComponent(keyword)}` : ""},sortBy=POSTING_DATES_DESC`;
      const page = await fetchJson<{ items?: any[] }>(
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${finder}`,
        signal
      );
      const root = page.items?.[0];
      const list: any[] = root?.requisitionList || [];
      for (const job of list) {
        candidates.push({
          externalId: String(job.Id),
          title: String(job.Title || ""),
          location: String(job.PrimaryLocation || ""),
          applyLink: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${job.Id}`,
          postedAt: toIso(job.PostedDate),
        });
      }
      if (list.length < 25 || offset + 25 >= (root?.TotalJobsCount || 0)) break;
      // Newest-first: once a page ends outside the age window, later pages
      // can only be older still.
      const last = candidates[candidates.length - 1];
      if (!isRecent(last?.postedAt ?? null)) break;
    }
    return candidates;
  },
  async hydrate(source, candidate, signal) {
    const { host, site } = source as Source<"oracle">;
    const detail = await fetchJson<{ items?: any[] }>(
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="${candidate.externalId}",siteNumber=${site}`,
      signal
    );
    const item = detail.items?.[0] || {};
    const description = [
      item.ExternalDescriptionStr,
      item.ExternalResponsibilitiesStr,
      item.ExternalQualificationsStr,
    ]
      .map((part) => htmlToText(String(part || "")))
      .filter(Boolean)
      .join("\n\n");
    return { description };
  },
};

// --- Phenom People: one POST lists every job; the job page carries JSON-LD. -
function phenomBody(from: number) {
  return {
    lang: "en_us", deviceType: "desktop", country: "us", pageName: "search-results",
    ddoKey: "refineSearch", sortBy: "Most recent", subsearch: "", from, jobs: true,
    counts: true, all_fields: ["category", "country", "state", "city", "type"], size: 100,
    clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: "page11",
    siteType: "external", keywords: "", global: true, selected_fields: {},
    sort: { order: "desc", field: "postedDate" }, locationData: {},
  };
}

/** The first schema.org JobPosting found in a page's JSON-LD blocks. */
function findJobPosting(html: string): any | null {
  const $ = load(html);
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(element).contents().text().replace(/[\u0000-\u001f]+/g, " ");
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      const posting = nodes.find((node: any) => node?.["@type"] === "JobPosting");
      if (posting) return posting;
    } catch {
      /* try the next block */
    }
  }
  return null;
}

const phenom: FreeJobAdapter = {
  async list(source, signal) {
    const { host, locale } = source as Source<"phenom">;
    const candidates: JobCandidate[] = [];
    for (let from = 0; from < 500; from += 100) {
      const data = await fetchJson<any>(`https://${host}/widgets`, signal, {
        method: "POST",
        body: phenomBody(from),
      });
      const jobs: any[] = data?.refineSearch?.data?.jobs || [];
      for (const job of jobs) {
        candidates.push({
          externalId: String(job.reqId || job.jobId),
          title: String(job.title || ""),
          location: String(job.location || ""),
          applyLink: `https://${host}/${locale}/job/${job.reqId || job.jobId}`,
          postedAt: toIso(job.postedDate),
        });
      }
      if (jobs.length < 100 || from + 100 >= (data?.refineSearch?.totalHits || 0)) break;
    }
    return candidates;
  },
  async hydrate(_source, candidate, signal) {
    const posting = findJobPosting(await fetchText(candidate.applyLink, signal));
    return {
      description: htmlToText(String(posting?.description || "")),
      postedAt: toIso(posting?.datePosted) || candidate.postedAt,
    };
  },
};

// --- Workable: POST lists an account's jobs; a GET per job has the text. ----
const workable: FreeJobAdapter = {
  async list(source, signal) {
    const { account } = source as Source<"workable">;
    const candidates: JobCandidate[] = [];
    let token: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const data = await fetchJson<any>(
        `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(account)}/jobs`,
        signal,
        {
          method: "POST",
          body: { query: "", location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) },
        }
      );
      for (const job of data.results || []) {
        candidates.push({
          externalId: String(job.shortcode),
          title: String(job.title || ""),
          location: [job.location?.city, job.location?.country].filter(Boolean).join(", "),
          applyLink: `https://apply.workable.com/${account}/j/${job.shortcode}/`,
          postedAt: toIso(job.published),
        });
      }
      token = data.nextPage;
      if (!token) break;
    }
    return candidates;
  },
  async hydrate(source, candidate, signal) {
    const { account } = source as Source<"workable">;
    const detail = await fetchJson<any>(
      `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(account)}/jobs/${encodeURIComponent(candidate.externalId)}`,
      signal
    );
    const description = [detail.description, detail.requirements, detail.benefits]
      .map((part) => htmlToText(String(part || "")))
      .filter(Boolean)
      .join("\n\n");
    return { description };
  },
};

// --- Eightfold: a search API (newest first) plus a per-position detail API. -
const eightfold: FreeJobAdapter = {
  async list(source, signal) {
    const { host, domain, query } = source as Source<"eightfold">;
    const candidates: JobCandidate[] = [];
    let total = 0;
    for (let start = 0; start < 200; start += 10) {
      const params = new URLSearchParams({
        domain,
        query: query || "Abu Dhabi",
        location: "",
        start: String(start),
        sort_by: "timestamp",
      });
      const page = await fetchJson<{ data?: { positions?: any[]; count?: number } }>(
        `https://${host}/api/pcsx/search?${params}`,
        signal
      );
      const positions = page.data?.positions || [];
      if (start === 0) total = page.data?.count || 0;
      for (const job of positions) {
        candidates.push({
          externalId: String(job.id),
          title: String(job.name || ""),
          location: (job.locations || []).join(" | "),
          applyLink: `https://${host}${job.positionUrl || `/careers/job/${job.id}`}`,
          postedAt: toIso(job.postedTs ? Number(job.postedTs) * 1000 : null),
        });
      }
      if (!positions.length || start + 10 >= total) break;
      // Newest-first: stop once a page ends outside the age window.
      if (!isRecent(candidates[candidates.length - 1]?.postedAt ?? null)) break;
    }
    return candidates;
  },
  async hydrate(source, candidate, signal) {
    const { host, domain } = source as Source<"eightfold">;
    const detail = await fetchJson<{ data?: { jobDescription?: string } }>(
      `https://${host}/api/pcsx/position_details?position_id=${encodeURIComponent(candidate.externalId)}&domain=${encodeURIComponent(domain)}&hl=en`,
      signal
    );
    return { description: htmlToText(String(detail.data?.jobDescription || "")) };
  },
};

// --- SAP SuccessFactors: jobs come from sitemap.xml, details from the page. -
const COUNTRY_NAMES: Record<string, string> = { AE: "United Arab Emirates", ARE: "United Arab Emirates" };

const successfactors: FreeJobAdapter = {
  async list(source, signal) {
    const { host } = source as Source<"successfactors">;
    const xml = await fetchText(`https://${host}/sitemap.xml`, signal);
    const candidates: JobCandidate[] = [];
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = match[1].replace(/&amp;/g, "&").trim();
      const parts = (() => {
        try {
          return new URL(url).pathname.split("/").filter(Boolean);
        } catch {
          return [];
        }
      })();
      const jobIndex = parts.indexOf("job");
      if (jobIndex < 0 || parts.length < jobIndex + 3) continue;
      const slug = decodeURIComponent(parts[jobIndex + 1]).replace(/&amp;/g, "&");
      candidates.push({
        externalId: parts[jobIndex + 2],
        // The slug is "<location>-<title words>"; good enough to pre-filter
        // by title before any page is downloaded.
        title: slug.replace(/-+/g, " ").trim(),
        location: "",
        locationUnknown: true,
        applyLink: url,
        postedAt: null,
      });
    }
    return candidates;
  },
  async hydrate(_source, candidate, signal) {
    const $ = load(await fetchText(candidate.applyLink, signal));
    const meta = (name: string) => $(`meta[itemprop="${name}"]`).first().attr("content")?.trim() || "";
    const country = meta("addressCountry");
    const countryName = COUNTRY_NAMES[country.toUpperCase()] || country;
    // Most sites use addressLocality; some (EGA) put "<city>, <country code>"
    // in streetAddress instead.
    const locality = meta("addressLocality") || meta("streetAddress").replace(/,\s*[A-Z]{2,3}$/, "");
    // Some sites put the country in the locality field too; don't repeat it.
    const location = [...new Set([locality, countryName].filter(Boolean))].join(", ");
    return {
      description: htmlToText($('[itemprop="description"]').first().html() || ""),
      postedAt: toIso(meta("datePosted")) || candidate.postedAt,
      location,
      title: $('[itemprop="title"]').first().text().trim() || candidate.title,
    };
  },
};

export const ADAPTERS: Record<FreeJobSource["adapter"], FreeJobAdapter> = {
  greenhouse,
  lever,
  smartrecruiters,
  workday,
  oracle,
  phenom,
  workable,
  eightfold,
  successfactors,
};
