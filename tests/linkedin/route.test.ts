import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchLinkedInListings: vi.fn(),
  fetchLinkedInJobDescription: vi.fn(),
  clearLinkedInListingsMemory: vi.fn(),
}));

vi.mock("@/lib/linkedinListings.server", () => ({
  fetchLinkedInListings: mocks.fetchLinkedInListings,
  clearLinkedInListingsMemory: mocks.clearLinkedInListingsMemory,
}));
vi.mock("@/lib/linkedinJobs.server", () => ({
  fetchLinkedInJobDescription: mocks.fetchLinkedInJobDescription,
}));

import { GET } from "@/app/api/jobs/route";

const job = (id: string, title: string) => ({
  id: `linkedin-${id}`,
  title,
  company: "Acme",
  location: "Abu Dhabi, United Arab Emirates",
  salary: null,
  description: "LinkedIn listing for x. The full description will be loaded before tailoring.",
  applyLink: `https://www.linkedin.com/jobs/view/${id}`,
  source: "LinkedIn",
  postedAt: "2026-10-21",
});

const result = (extra: object = {}) => ({
  jobs: [job("1001", "Operations Manager"), job("1002", "Head of Finance")],
  syncMode: "saved",
  syncedAt: 1_800_000_000_000,
  nextSyncAt: null,
  attemptedRequests: 0,
  failedRequests: 0,
  blocked: false,
  ...extra,
});

const get = (query: string) => GET(new Request(`http://localhost/api/jobs?${query}`));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/jobs?source=linkedin", () => {
  it("returns the saved list with its sync time and does not ask for a refresh", async () => {
    mocks.fetchLinkedInListings.mockResolvedValue(result());
    const response = await get("source=linkedin");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs).toHaveLength(2);
    expect(body.providerSyncedAt).toBe(1_800_000_000_000);
    expect(body.note).toContain("2 saved LinkedIn listings");
    expect(mocks.fetchLinkedInListings).toHaveBeenCalledWith(false);
  });

  it("passes a manual refresh through", async () => {
    mocks.fetchLinkedInListings.mockResolvedValue(result({ syncMode: "live", attemptedRequests: 9, newJobsCount: 2 }));
    const body = await (await get("source=linkedin&refresh=1")).json();
    expect(mocks.fetchLinkedInListings).toHaveBeenCalledWith(true);
    expect(body.note).toContain("9 requests");
    expect(body.note).toContain("added 2 new");
  });

  it("filters by keyword", async () => {
    mocks.fetchLinkedInListings.mockResolvedValue(result());
    const body = await (await get("source=linkedin&keyword=finance")).json();
    expect(body.jobs.map((candidate: { title: string }) => candidate.title)).toEqual(["Head of Finance"]);
  });

  it("tells the user when LinkedIn limited the read and that saved jobs were kept", async () => {
    mocks.fetchLinkedInListings.mockResolvedValue(result({ syncMode: "live", blocked: true, attemptedRequests: 3 }));
    const body = await (await get("source=linkedin&refresh=1")).json();
    expect(body.note).toMatch(/limited the requests/);
    expect(body.note).toMatch(/Saved listings were kept/);
  });

  it("says so when it is showing the saved list because LinkedIn could not be reached", async () => {
    mocks.fetchLinkedInListings.mockResolvedValue(result({ syncMode: "stale" }));
    const body = await (await get("source=linkedin&refresh=1")).json();
    expect(body.note).toMatch(/could not be reached/);
    expect(body.jobs).toHaveLength(2);
  });

  it("answers 502 with a clear note when there is nothing saved and LinkedIn is blocked", async () => {
    mocks.fetchLinkedInListings.mockRejectedValue(new Error("LinkedIn blocked the request (HTTP 429)"));
    const response = await get("source=linkedin");
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.jobs).toEqual([]);
    expect(body.note).toContain("LinkedIn jobs could not be loaded");
    expect(body.note).not.toMatch(/credit/i);
  });

  it("never falls back to mixed career-site results under the LinkedIn toggle", async () => {
    mocks.fetchLinkedInListings.mockRejectedValue(new Error("down"));
    const body = await (await get("source=linkedin")).json();
    expect(body.jobs).toEqual([]);
  });
});

describe("GET /api/jobs?source=linkedin&jobId=", () => {
  it("returns the posting's description", async () => {
    mocks.fetchLinkedInJobDescription.mockResolvedValue("Lead the finance team.");
    const response = await get("source=linkedin&jobId=4480648429");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ description: "Lead the finance team." });
    expect(mocks.fetchLinkedInJobDescription).toHaveBeenCalledWith("4480648429");
  });

  it("answers 502 with a retry message when LinkedIn will not serve the posting", async () => {
    mocks.fetchLinkedInJobDescription.mockRejectedValue(new Error("LinkedIn blocked the request (HTTP 429)"));
    const response = await get("source=linkedin&jobId=4480648429");
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/could not be loaded.*try again/i);
  });
});
