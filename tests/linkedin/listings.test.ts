import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkedInCrawl } from "@/lib/linkedinJobs.server";

// The LinkedIn saved list, with a fake crawler and no storage: how a read is
// merged with what is saved, and what a block, a failure or a cooldown does.
const state = vi.hoisted(() => ({
  next: null as null | LinkedInCrawl | Error,
  crawls: 0,
  cursors: [] as number[],
  saved: [] as { jobs: unknown[]; metadata: Record<string, number | null> }[],
}));

vi.mock("@/lib/linkedinJobs.server", () => ({
  crawlLinkedInCards: vi.fn(async (_signal: unknown, cursor: number) => {
    state.crawls += 1;
    state.cursors.push(cursor);
    if (state.next instanceof Error) throw state.next;
    return state.next;
  }),
}));
vi.mock("@/lib/jobListingStore.server", () => ({
  getJobListingSavedAt: vi.fn(async () => null),
  loadJobListingSnapshot: vi.fn(async () => null),
  saveJobListingSnapshot: vi.fn(
    async (_provider: string, jobs: unknown[], metadata: Record<string, number | null>) => {
      state.saved.push({ jobs, metadata });
      return true;
    }
  ),
}));

const HOUR = 3_600_000;
type Listings = typeof import("@/lib/linkedinListings.server");
let listings: Listings;

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const card = (id: string, title = "Operations Manager", ageDays = 2, location = "Abu Dhabi, United Arab Emirates") => ({
  id,
  title,
  company: "Acme",
  location,
  applyLink: `https://www.linkedin.com/jobs/view/${id}`,
  postedIso: day(ageDays),
});
const crawl = (cards: ReturnType<typeof card>[], extra: Partial<LinkedInCrawl> = {}): LinkedInCrawl => ({
  cards,
  attemptedRequests: 4,
  failedRequests: 0,
  blocked: false,
  nextCursor: 4,
  slotsRead: 4,
  totalSlots: 18,
  ...extra,
});
const idsOf = (jobs: { id: string }[]) => jobs.map((job) => job.id.replace("linkedin-", "")).sort();

async function sync(force = true) {
  vi.setSystemTime(Date.now() + 13 * HOUR);
  return listings.fetchLinkedInListings(force);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  vi.resetModules();
  state.next = null;
  state.crawls = 0;
  state.cursors = [];
  state.saved = [];
  listings = await import("@/lib/linkedinListings.server");
});
afterEach(() => vi.useRealTimers());

describe("LinkedIn saved list", () => {
  it("saves what LinkedIn lists as light cards the client can open later", async () => {
    state.next = crawl([card("1001"), card("1002", "Head of Finance")]);
    const result = await sync();
    expect(result.syncMode).toBe("live");
    expect(idsOf(result.jobs)).toEqual(["1001", "1002"]);
    const job = result.jobs.find((candidate) => candidate.id === "linkedin-1001")!;
    expect(job.source).toBe("LinkedIn");
    expect(job.applyLink).toBe("https://www.linkedin.com/jobs/view/1001");
    // The marker sentence the client uses to fetch the real description on open.
    expect(job.description).toContain("full description will be loaded before tailoring");
    expect(result.newJobsCount).toBe(2);
  });

  it("applies the same title, place and age rules as the career-site list", async () => {
    state.next = crawl([
      card("2001", "Operations Manager"),
      card("2002", "Software Engineer"),
      card("2003", "Operations Manager", 2, "Dubai, United Arab Emirates"),
      card("2004", "Operations Manager", 45),
    ]);
    expect(idsOf((await sync()).jobs)).toEqual(["2001"]);
  });

  it("does not drop a saved job just because a later read did not list it", async () => {
    state.next = crawl([card("3001"), card("3002")]);
    await sync();
    // It has most likely moved past the pages that were read, not closed.
    state.next = crawl([card("3001")]);
    expect(idsOf((await sync()).jobs)).toEqual(["3001", "3002"]);
    expect(idsOf((await sync()).jobs)).toEqual(["3001", "3002"]);
  });

  it("drops a saved job once it is past the 30-day window", async () => {
    state.next = crawl([card("4001", "Operations Manager", 29), card("4002", "Operations Manager", 2)]);
    await sync();
    // A day later the first is 30+ days old, and LinkedIn no longer lists it.
    vi.setSystemTime(Date.now() + 3 * 86_400_000);
    state.next = crawl([card("4002", "Operations Manager", 2)]);
    expect(idsOf((await sync()).jobs)).toEqual(["4002"]);
  });

  it("keeps everything saved and reports a block when LinkedIn limits the read", async () => {
    state.next = crawl([card("5001"), card("5002")]);
    await sync();
    state.next = crawl([card("5003")], { blocked: true, failedRequests: 1 });
    const result = await sync();
    expect(result.blocked).toBe(true);
    expect(idsOf(result.jobs)).toEqual(["5001", "5002", "5003"]);
  });

  it("serves the saved list when LinkedIn cannot be reached", async () => {
    state.next = crawl([card("6001")]);
    await sync();
    state.next = new Error("LinkedIn blocked the request (HTTP 429)");
    const result = await sync();
    expect(result.syncMode).toBe("stale");
    expect(idsOf(result.jobs)).toEqual(["6001"]);
  });

  it("fails clearly, not with an empty list, when there is nothing saved and LinkedIn is blocked", async () => {
    state.next = new Error("LinkedIn blocked the request (HTTP 429)");
    await expect(sync()).rejects.toThrow(/blocked/);
  });

  it("answers from the saved list inside the cooldown and the refresh interval", async () => {
    state.next = crawl([card("7001")]);
    await sync();
    expect(state.crawls).toBe(1);

    // Pressing Refresh again straight away does not touch LinkedIn.
    const again = await listings.fetchLinkedInListings(true);
    expect(again.syncMode).toBe("cooldown");
    expect(state.crawls).toBe(1);

    // Nor does an ordinary load of a list that is only a few hours old.
    vi.setSystemTime(Date.now() + 3 * HOUR);
    const load = await listings.fetchLinkedInListings(false);
    expect(load.syncMode).toBe("saved");
    expect(state.crawls).toBe(1);
  });

  it("reads LinkedIn on load once the saved list is old", async () => {
    state.next = crawl([card("8001")]);
    await sync();
    state.next = crawl([card("8001"), card("8002")]);
    vi.setSystemTime(Date.now() + 13 * HOUR);
    const result = await listings.fetchLinkedInListings(false);
    expect(result.syncMode).toBe("live");
    expect(idsOf(result.jobs)).toEqual(["8001", "8002"]);
  });
});

describe("LinkedIn cursor", () => {
  it("starts at the first search and carries on where the last sync stopped", async () => {
    state.next = crawl([card("1")], { nextCursor: 4 });
    await sync();
    state.next = crawl([card("2")], { nextCursor: 8 });
    await sync();
    state.next = crawl([card("3")], { nextCursor: 12 });
    await sync();
    expect(state.cursors).toEqual([0, 4, 8]);
  });

  it("saves the cursor with the list so another server instance carries on from it", async () => {
    state.next = crawl([card("1")], { nextCursor: 4 });
    await sync();
    expect(state.saved.at(-1)?.metadata.cursor).toBe(4);
  });

  it("holds the cursor at the refused search when LinkedIn blocks", async () => {
    state.next = crawl([card("1")], { nextCursor: 6, blocked: true, failedRequests: 1, slotsRead: 2 });
    await sync();
    state.next = crawl([card("2")], { nextCursor: 10 });
    await sync();
    expect(state.cursors).toEqual([0, 6]);
  });

  it("starts the cycle again after the saved list is cleared", async () => {
    state.next = crawl([card("1")], { nextCursor: 4 });
    await sync();
    listings.clearLinkedInListingsMemory();
    state.next = crawl([card("2")], { nextCursor: 4 });
    await sync();
    expect(state.cursors).toEqual([0, 0]);
  });

  it("builds a full list across syncs, each adding what it read", async () => {
    state.next = crawl([card("1"), card("2")], { nextCursor: 4 });
    await sync();
    state.next = crawl([card("3")], { nextCursor: 8 });
    const result = await sync();
    expect(idsOf(result.jobs)).toEqual(["1", "2", "3"]);
  });
});

describe("scheduled LinkedIn sync", () => {
  it("runs when there is nothing saved", async () => {
    state.next = crawl([card("9001")]);
    const result = await listings.runScheduledLinkedInSync();
    expect(result).toMatchObject({ ran: true, jobs: 1, blocked: false });
  });

  it("leaves LinkedIn alone when the saved list was read less than 90 minutes ago", async () => {
    state.next = crawl([card("9101")]);
    await listings.runScheduledLinkedInSync();
    vi.setSystemTime(Date.now() + 0.5 * HOUR);
    const result = await listings.runScheduledLinkedInSync();
    expect(result.ran).toBe(false);
    expect(state.crawls).toBe(1);
  });

  it("runs again on the next cron, two hours later, and carries on from the cursor", async () => {
    state.next = crawl([card("9201")], { nextCursor: 4 });
    await listings.runScheduledLinkedInSync();
    vi.setSystemTime(Date.now() + 2 * HOUR);
    const result = await listings.runScheduledLinkedInSync();
    expect(result.ran).toBe(true);
    expect(state.crawls).toBe(2);
    expect(state.cursors).toEqual([0, 4]);
  });
});
