import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "@/lib/types";

// The sync runner with fake career sites and no storage: what matters here is
// how it treats the listings a site returns, fails to return, or cuts short.
const state = vi.hoisted(() => ({
  sources: [
    { id: "alpha", employer: "Alpha Co", adapter: "greenhouse", slug: "alpha" },
    { id: "beta", employer: "Beta Co", adapter: "greenhouse", slug: "beta" },
  ],
  // What each fake site lists next; "fail" makes it throw.
  listings: {} as Record<string, "fail" | { ids: string[]; incomplete?: boolean; postedAt?: string }>,
}));

vi.mock("@/lib/freeJobs/sources", () => ({ FREE_JOB_SOURCES: state.sources }));
vi.mock("@/lib/freeJobs/adapters", () => ({
  ADAPTERS: {
    greenhouse: {
      async list(source: { id: string }) {
        const listing = state.listings[source.id];
        if (!listing || listing === "fail") throw new Error("site down");
        const candidates = listing.ids.map((id) => ({
          externalId: id,
          title: `Senior Manager ${id}`,
          location: "Abu Dhabi",
          applyLink: `https://example.com/${source.id}/${id}`,
          postedAt: listing.postedAt ?? new Date().toISOString(),
          description: "A long enough description. ".repeat(20),
        }));
        return Object.assign(candidates, { incomplete: listing.incomplete === true });
      },
    },
  },
}));
vi.mock("@/lib/jobListingStore.server", () => ({
  getJobListingSavedAt: vi.fn(async () => null),
  loadJobListingSnapshot: vi.fn(async () => null),
  saveJobListingSnapshot: vi.fn(async () => true),
}));

const HOUR = 3_600_000;
type Runner = typeof import("@/lib/freeJobs.server");
let runner: Runner;

const idsOf = (jobs: Job[], company: string) =>
  jobs
    .filter((job) => job.company === company)
    .map((job) => job.title.replace("Senior Manager ", ""))
    .sort();
const find = (jobs: Job[], company: string, ext: string) =>
  jobs.find((job) => job.company === company && job.title.endsWith(ext));

async function sync() {
  vi.setSystemTime(Date.now() + HOUR);
  return runner.fetchFreeJobs(true);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
  vi.resetModules();
  state.listings = {};
  runner = await import("@/lib/freeJobs.server");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("free job sync", () => {
  it("saves what the sites list and remembers when each was first seen", async () => {
    state.listings = { alpha: { ids: ["a1", "a2"] }, beta: { ids: ["b1"] } };
    const first = await sync();
    expect(first.jobs).toHaveLength(3);
    const seenAt = find(first.jobs, "Alpha Co", "a1")?.firstSeenAt;
    expect(seenAt).toBeTypeOf("number");

    state.listings.alpha = { ids: ["a1", "a2", "a3"] };
    const second = await sync();
    expect(find(second.jobs, "Alpha Co", "a1")?.firstSeenAt).toBe(seenAt);
    expect(find(second.jobs, "Alpha Co", "a3")?.firstSeenAt).toBeGreaterThan(seenAt as number);
    expect(second.newJobsCount).toBe(1);
  });

  it("removes a closed job only after the second complete sync that misses it", async () => {
    state.listings = { alpha: { ids: ["a1", "a2"] }, beta: { ids: ["b1"] } };
    await sync();

    state.listings.alpha = { ids: ["a1"] };
    const afterFirstMiss = await sync();
    expect(idsOf(afterFirstMiss.jobs, "Alpha Co")).toEqual(["a1", "a2"]);

    const afterSecondMiss = await sync();
    expect(idsOf(afterSecondMiss.jobs, "Alpha Co")).toEqual(["a1"]);
    expect(idsOf(afterSecondMiss.jobs, "Beta Co")).toEqual(["b1"]);
  });

  it("does not remove a job that comes back before the second miss", async () => {
    state.listings = { alpha: { ids: ["a1", "a2"] }, beta: { ids: ["b1"] } };
    await sync();

    state.listings.alpha = { ids: ["a1"] };
    await sync();
    state.listings.alpha = { ids: ["a1", "a2"] };
    await sync();
    state.listings.alpha = { ids: ["a1"] };
    const result = await sync();
    // The earlier miss was cleared when a2 came back, so this is a first miss again.
    expect(idsOf(result.jobs, "Alpha Co")).toEqual(["a1", "a2"]);
  });

  it("keeps a site's jobs untouched while the site is down", async () => {
    state.listings = { alpha: { ids: ["a1", "a2"] }, beta: { ids: ["b1"] } };
    await sync();

    state.listings.alpha = "fail";
    state.listings.beta = { ids: ["b1", "b2"] };
    for (let i = 0; i < 3; i += 1) {
      const result = await sync();
      expect(result.failedSources).toEqual(["Alpha Co"]);
      expect(idsOf(result.jobs, "Alpha Co")).toEqual(["a1", "a2"]);
      expect(idsOf(result.jobs, "Beta Co")).toEqual(["b1", "b2"]);
      expect(find(result.jobs, "Alpha Co", "a1")?.missedSyncs).toBeUndefined();
    }
  });

  it("keeps the jobs a site cut off at its page limit never showed", async () => {
    state.listings = { alpha: { ids: ["a1", "a2", "a3"] }, beta: { ids: ["b1"] } };
    await sync();

    state.listings.alpha = { ids: ["a1"], incomplete: true };
    for (let i = 0; i < 3; i += 1) {
      const result = await sync();
      expect(result.incompleteSources).toEqual(["Alpha Co"]);
      expect(idsOf(result.jobs, "Alpha Co")).toEqual(["a1", "a2", "a3"]);
    }
  });

  it("keeps a site's jobs when the site suddenly lists nothing at all", async () => {
    state.listings = { alpha: { ids: ["a1", "a2"] }, beta: { ids: ["b1"] } };
    await sync();

    // An empty answer looks like a changed page format, not every job closing.
    state.listings.alpha = { ids: [] };
    for (let i = 0; i < 3; i += 1) {
      const result = await sync();
      expect(result.failedSources).toEqual(["Alpha Co"]);
      expect(idsOf(result.jobs, "Alpha Co")).toEqual(["a1", "a2"]);
      expect(idsOf(result.jobs, "Beta Co")).toEqual(["b1"]);
    }
  });

  it("does not flag a site that lists nothing when it has never had jobs saved", async () => {
    state.listings = { alpha: { ids: [] }, beta: { ids: ["b1"] } };
    const result = await sync();
    expect(result.failedSources).toEqual([]);
    expect(idsOf(result.jobs, "Beta Co")).toEqual(["b1"]);
  });

  it("still lets a site's closed jobs go when it lists others", async () => {
    state.listings = { alpha: { ids: ["a1", "a2"] }, beta: { ids: ["b1"] } };
    await sync();

    state.listings.alpha = { ids: ["a1"] };
    await sync();
    const result = await sync();
    expect(idsOf(result.jobs, "Alpha Co")).toEqual(["a1"]);
  });

  it("drops at once a job the site still lists but that is now too old", async () => {
    state.listings = { alpha: { ids: ["a1", "a2"] }, beta: { ids: ["b1"] } };
    await sync();

    state.listings.alpha = { ids: ["a1", "a2"], postedAt: "2026-06-01T00:00:00Z" };
    const result = await sync();
    expect(idsOf(result.jobs, "Alpha Co")).toEqual([]);
    expect(idsOf(result.jobs, "Beta Co")).toEqual(["b1"]);
  });

  it("answers from the saved list inside the refresh cooldown without asking the sites", async () => {
    state.listings = { alpha: { ids: ["a1"] }, beta: { ids: ["b1"] } };
    await sync();
    state.listings = { alpha: "fail", beta: "fail" };
    const result = await runner.fetchFreeJobs(true);
    expect(result.syncMode).toBe("cooldown");
    expect(result.jobs).toHaveLength(2);
  });
});

describe("toLiteJob", () => {
  it("empties the description but keeps a stable hash of it", () => {
    const job = {
      id: "x",
      title: "Manager",
      company: "X",
      location: "Abu Dhabi",
      salary: null,
      description: "full text",
      applyLink: null,
      source: null,
      postedAt: null,
    } satisfies Job;
    const lite = runner.toLiteJob(job);
    expect(lite.description).toBe("");
    expect(lite.descriptionHash).toBe(runner.descriptionHash("full text"));
    expect(runner.toLiteJob(lite).descriptionHash).toBe(lite.descriptionHash);
  });
});
