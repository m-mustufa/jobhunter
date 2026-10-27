import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { profile } from "./fixtures/cv";

// The small API routes: stored profile, job descriptions, recommendations,
// the employer directory, the scheduled sync and the career-site job list.
// Storage and the sync runners are replaced; the route code itself is real.

const mocks = vi.hoisted(() => ({
  loadStoredProfile: vi.fn(),
  saveStoredProfile: vi.fn(),
  getSavedFreeJobs: vi.fn(),
  fetchFreeJobs: vi.fn(),
  runScheduledSync: vi.fn(),
  clearFreeJobsMemoryCache: vi.fn(),
  runScheduledLinkedInSync: vi.fn(),
  clearLinkedInListingsMemory: vi.fn(),
  clearJobListingSnapshots: vi.fn(),
}));

vi.mock("@/lib/profileStore.server", () => ({
  loadStoredProfile: mocks.loadStoredProfile,
  saveStoredProfile: mocks.saveStoredProfile,
}));
vi.mock("@/lib/freeJobs.server", () => ({
  getSavedFreeJobs: mocks.getSavedFreeJobs,
  fetchFreeJobs: mocks.fetchFreeJobs,
  runScheduledSync: mocks.runScheduledSync,
  clearFreeJobsMemoryCache: mocks.clearFreeJobsMemoryCache,
  toLiteJob: (job: object) => ({ ...job, description: "" }),
}));
vi.mock("@/lib/linkedinListings.server", () => ({
  fetchLinkedInListings: vi.fn(),
  runScheduledLinkedInSync: mocks.runScheduledLinkedInSync,
  clearLinkedInListingsMemory: mocks.clearLinkedInListingsMemory,
}));
vi.mock("@/lib/linkedinJobs.server", () => ({ fetchLinkedInJobDescription: vi.fn() }));
vi.mock("@/lib/jobListingStore.server", () => ({ clearJobListingSnapshots: mocks.clearJobListingSnapshots }));

import { GET as getProfile, PUT as putProfile } from "@/app/api/profile/route";
import { GET as getDescription } from "@/app/api/jobs/description/route";
import { POST as postRecommendations } from "@/app/api/jobs/recommendations/route";
import { GET as getEmployers } from "@/app/api/employers/route";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/sync/route";
import { DELETE as deleteJobs, GET as getJobs } from "@/app/api/jobs/route";
import { EMPLOYER_DIRECTORY } from "@/lib/employerDirectory";

const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const jsonRequest = (url: string, method: string, body: unknown) =>
  request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const savedJob = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: "Senior Quality Manager",
  company: "Example Energy",
  location: "Abu Dhabi, United Arab Emirates",
  salary: null,
  description:
    "Senior Quality Manager. Responsibilities: lead the quality team and supplier audits; report quality performance to senior management; drive corrective actions to closure; manage contractor inspections and third-party inspection; develop engineers through training.",
  applyLink: `https://example.com/${id}`,
  source: "Example careers site",
  postedAt: "2026-10-20",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/profile", () => {
  it("says nothing is stored yet", async () => {
    mocks.loadStoredProfile.mockResolvedValue(null);
    expect(await (await getProfile()).json()).toEqual({ found: false });
  });

  it("returns the stored profile and master CV", async () => {
    mocks.loadStoredProfile.mockResolvedValue({ profile, masterCV: "Master CV text" });
    const body = await (await getProfile()).json();
    expect(body.found).toBe(true);
    expect(body.masterCV).toBe("Master CV text");
    expect(body.profile.name).toBe(profile.name);
  });

  it("saves a profile and master CV", async () => {
    mocks.saveStoredProfile.mockResolvedValue(true);
    const res = await putProfile(jsonRequest("/api/profile", "PUT", { profile, masterCV: "Master CV text" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.saveStoredProfile).toHaveBeenCalledWith({ profile, masterCV: "Master CV text" });
  });

  it("stores only the profile fields the app knows, in their proper types", async () => {
    mocks.saveStoredProfile.mockResolvedValue(true);
    const messy = { ...profile, skills: "not a list", links: [1, 2], injected: "<script>", summary: 42 };
    await putProfile(jsonRequest("/api/profile", "PUT", { profile: messy, masterCV: "x" }));
    const saved = mocks.saveStoredProfile.mock.calls[0][0].profile;
    expect(saved.skills).toEqual([]);
    expect(saved.links).toEqual(["1", "2"]);
    expect(saved.summary).toBe("");
    expect(saved).not.toHaveProperty("injected");
    expect(saved.experience).toEqual(profile.experience);
    expect(saved.name).toBe(profile.name);
  });

  it.each([
    ["a body that is not JSON", "{nope"],
    ["no profile", { masterCV: "x" }],
    ["a master CV that is not text", { profile, masterCV: 5 }],
    ["an empty body", {}],
  ])("answers 400 for %s", async (_label, body) => {
    const res = await putProfile(jsonRequest("/api/profile", "PUT", body));
    expect(res.status).toBe(400);
    expect(mocks.saveStoredProfile).not.toHaveBeenCalled();
  });

  it("answers 503 when the store cannot be written", async () => {
    mocks.saveStoredProfile.mockResolvedValue(false);
    const res = await putProfile(jsonRequest("/api/profile", "PUT", { profile, masterCV: "x" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/BLOB_READ_WRITE_TOKEN/);
  });
});

describe("/api/jobs/description", () => {
  it("returns a saved job's full description", async () => {
    mocks.getSavedFreeJobs.mockResolvedValue([savedJob("a"), savedJob("b", { description: "Only for b." })]);
    const res = await getDescription(request("/api/jobs/description?id=b"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ description: "Only for b." });
  });

  it("answers 400 without an id", async () => {
    expect((await getDescription(request("/api/jobs/description"))).status).toBe(400);
    expect((await getDescription(request("/api/jobs/description?id=%20"))).status).toBe(400);
  });

  it("answers 404 for a job that is no longer saved or has no text", async () => {
    mocks.getSavedFreeJobs.mockResolvedValue([savedJob("a", { description: "" })]);
    for (const id of ["gone", "a"]) {
      const res = await getDescription(request(`/api/jobs/description?id=${id}`));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatch(/no longer saved/);
    }
  });
});

describe("/api/jobs/recommendations", () => {
  it("scores every saved job against the profile", async () => {
    mocks.getSavedFreeJobs.mockResolvedValue([
      savedJob("fit"),
      savedJob("nofit", {
        title: "Executive Pastry Chef",
        description:
          "Executive Pastry Chef for a luxury hotel kitchen. Create dessert menus, manage the bakery brigade, order flour, chocolate and sugar, and keep the pastry section spotless every day.",
      }),
    ]);
    const res = await postRecommendations(jsonRequest("/api/jobs/recommendations", "POST", { profile }));
    expect(res.status).toBe(200);
    const { recommendations } = await res.json();
    expect(Object.keys(recommendations).sort()).toEqual(["fit", "nofit"]);
    expect(recommendations.fit.recommended).toBe(true);
    expect(recommendations.nofit.recommended).toBe(false);
  });

  it("answers 400 for a bad body or a missing profile", async () => {
    expect((await postRecommendations(jsonRequest("/api/jobs/recommendations", "POST", "{nope"))).status).toBe(400);
    expect((await postRecommendations(jsonRequest("/api/jobs/recommendations", "POST", {}))).status).toBe(400);
    expect((await postRecommendations(jsonRequest("/api/jobs/recommendations", "POST", { profile: "x" }))).status).toBe(400);
  });
});

describe("/api/employers", () => {
  it("lists every directory employer once, with a LinkedIn search link", async () => {
    const { employers, source } = await (await getEmployers()).json();
    const expected = EMPLOYER_DIRECTORY.reduce((sum, group) => sum + group.employers.length, 0);
    expect(source).toBe("reference");
    expect(employers).toHaveLength(expected);
    expect(new Set(employers.map((employer: any) => employer.id)).size).toBe(expected);
    for (const employer of employers) {
      expect(employer.name).toBeTruthy();
      expect(employer.industries).toHaveLength(1);
      expect(employer.jobsSearchUrl).toContain("linkedin.com");
    }
  });
});

describe("/api/cron/sync", () => {
  const withAuth = (secret = "s3cret") => ({ headers: { authorization: `Bearer ${secret}` } });
  const run = (init?: RequestInit, method: "GET" | "POST" = "POST") =>
    (method === "GET" ? cronGet : cronPost)(request("/api/cron/sync", { method, ...init }));

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    mocks.runScheduledSync.mockResolvedValue({ ran: true, jobs: 40, newJobs: 2, durationMs: 1000 });
    mocks.runScheduledLinkedInSync.mockResolvedValue({ ran: true, jobs: 12 });
  });

  it("refuses to run when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await run(withAuth());
    expect(res.status).toBe(503);
    expect(mocks.runScheduledSync).not.toHaveBeenCalled();
  });

  it.each([
    ["no authorization header", undefined],
    ["a wrong secret", { headers: { authorization: "Bearer nope" } }],
    ["a secret of another length", { headers: { authorization: "Bearer s3cret-and-more" } }],
    ["the secret without Bearer", { headers: { authorization: "s3cret" } }],
  ])("answers 401 for %s", async (_label, init) => {
    const res = await run(init as RequestInit | undefined);
    expect(res.status).toBe(401);
    expect(mocks.runScheduledSync).not.toHaveBeenCalled();
    expect(mocks.runScheduledLinkedInSync).not.toHaveBeenCalled();
  });

  it("runs both syncs and reports both results, for POST and GET", async () => {
    for (const method of ["POST", "GET"] as const) {
      const res = await run(withAuth(), method);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ran: true, jobs: 40, newJobs: 2, linkedin: { ran: true, jobs: 12 } });
    }
  });

  it("still succeeds when only the LinkedIn sync fails", async () => {
    mocks.runScheduledLinkedInSync.mockRejectedValue(new Error("LinkedIn blocked"));
    const res = await run(withAuth());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toBe(40);
    expect(body.linkedin).toEqual({ ran: false, reason: "LinkedIn blocked" });
  });

  it("answers 500 when the career-site sync fails", async () => {
    mocks.runScheduledSync.mockRejectedValue(new Error("storage down"));
    const res = await run(withAuth());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("storage down");
  });
});

describe("GET /api/jobs (career sites)", () => {
  const result = (extra: Record<string, unknown> = {}) => ({
    jobs: [
      savedJob("a", { title: "Head of Finance", description: "Finance leadership role with budgeting and treasury." }),
      savedJob("b", { title: "Director of Operations", description: "Operations leadership across several sites." }),
    ],
    syncMode: "saved",
    syncedAt: 1_800_000_000_000,
    nextSyncAt: null,
    attemptedSearches: 30,
    successfulSearches: 30,
    failedSearches: 0,
    failedSources: [],
    lateSources: [],
    incompleteSources: [],
    fetchedJobsCount: 100,
    newJobsCount: 3,
    fromCache: true,
    stale: false,
    ...extra,
  });
  const get = (query = "") => getJobs(request(`/api/jobs${query}`));

  it("sends cards without descriptions, and the full text when asked", async () => {
    mocks.fetchFreeJobs.mockResolvedValue(result());
    const lite = await (await get()).json();
    expect(lite.sample).toBe(false);
    expect(lite.jobs.map((job: any) => job.description)).toEqual(["", ""]);
    expect(lite.providerSyncedAt).toBe(1_800_000_000_000);

    const full = await (await get("?full=1")).json();
    expect(full.jobs[0].description).toContain("Finance leadership");
  });

  it("filters by keyword in the title, company or description", async () => {
    mocks.fetchFreeJobs.mockResolvedValue(result());
    const byTitle = await (await get("?keyword=Finance")).json();
    expect(byTitle.jobs.map((job: any) => job.id)).toEqual(["a"]);
    const byDescription = await (await get("?keyword=several%20sites")).json();
    expect(byDescription.jobs.map((job: any) => job.id)).toEqual(["b"]);
    const none = await (await get("?keyword=astronaut")).json();
    expect(none.jobs).toEqual([]);
    expect(none.note).toContain("No listings matched");
  });

  it("passes a manual refresh through", async () => {
    mocks.fetchFreeJobs.mockResolvedValue(result());
    await get("?refresh=1");
    expect(mocks.fetchFreeJobs).toHaveBeenLastCalledWith(true);
    await get();
    expect(mocks.fetchFreeJobs).toHaveBeenLastCalledWith(false);
  });

  it("explains each kind of read in the note", async () => {
    mocks.fetchFreeJobs.mockResolvedValue(result({ syncMode: "live" }));
    expect((await (await get()).json()).note).toContain("Checked 30 of 30 employer career sites");

    mocks.fetchFreeJobs.mockResolvedValue(result({ syncMode: "stale" }));
    expect((await (await get()).json()).note).toContain("Free sources are unavailable");

    mocks.fetchFreeJobs.mockResolvedValue(result({ syncMode: "cooldown", nextSyncAt: Date.now() + 5 * 60_000 }));
    expect((await (await get()).json()).note).toMatch(/Refreshed moments ago\. Next refresh in \d+m/);

    mocks.fetchFreeJobs.mockResolvedValue(
      result({ failedSources: ["Alpha Co"], lateSources: ["Beta Co"], incompleteSources: ["Gamma Co"] })
    );
    const note = (await (await get()).json()).note;
    expect(note).toContain("Could not reach: Alpha Co");
    expect(note).toContain("Still checking: Beta Co");
    expect(note).toContain("Gamma Co has more jobs than we read");
  });

  it("answers 502 with the saved listings left alone when the sources cannot be reached", async () => {
    mocks.fetchFreeJobs.mockRejectedValue(new Error("Blob offline"));
    const res = await get();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.jobs).toEqual([]);
    expect(body.error).toBe("Blob offline");
    expect(body.note).toContain("were not changed");
  });

  it("shows sample jobs only in demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const body = await (await get()).json();
    expect(body.sample).toBe(true);
    expect(body.jobs.length).toBeGreaterThan(0);
    expect(mocks.fetchFreeJobs).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/jobs", () => {
  const del = (body: unknown) => deleteJobs(jsonRequest("/api/jobs", "DELETE", body));

  it.each([
    ["a body that is not JSON", "{nope"],
    ["no confirmation", {}],
    ["a lower-case confirmation", { confirmation: "confirm" }],
    ["a confirmation that is not text", { confirmation: true }],
  ])("answers 400 and clears nothing for %s", async (_label, body) => {
    const res = await del(body);
    expect(res.status).toBe(400);
    expect(mocks.clearJobListingSnapshots).not.toHaveBeenCalled();
    expect(mocks.clearFreeJobsMemoryCache).not.toHaveBeenCalled();
  });

  it("clears memory and saved snapshots only on the exact word Confirm", async () => {
    mocks.clearJobListingSnapshots.mockResolvedValue(undefined);
    const res = await del({ confirmation: "Confirm" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mocks.clearFreeJobsMemoryCache).toHaveBeenCalledTimes(1);
    expect(mocks.clearLinkedInListingsMemory).toHaveBeenCalledTimes(1);
    expect(mocks.clearJobListingSnapshots).toHaveBeenCalledTimes(1);
  });

  it("answers 500 when the snapshots cannot be cleared", async () => {
    mocks.clearJobListingSnapshots.mockRejectedValue(new Error("blob error"));
    const res = await del({ confirmation: "Confirm" });
    expect(res.status).toBe(500);
  });
});
