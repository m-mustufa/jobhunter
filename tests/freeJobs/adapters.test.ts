import { afterEach, describe, expect, it, vi } from "vitest";

import { ADAPTERS } from "@/lib/freeJobs/adapters";
import type { FreeJobSource } from "@/lib/freeJobs/types";

const signal = new AbortController().signal;
const recent = () => new Date().toISOString();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("workday adapter", () => {
  const source: FreeJobSource = { id: "w", employer: "W", adapter: "workday", host: "w.example.com", tenant: "t", site: "s" };
  const posting = (n: number) => ({ title: `Manager ${n}`, externalPath: `/job/${n}`, locationsText: "Abu Dhabi", postedOn: "Posted Today" });
  const pages = (total: number) => (_url: string, init?: RequestInit) => {
    const { offset } = JSON.parse(String(init?.body));
    const count = Math.max(0, Math.min(20, total - offset));
    return json({ total: offset === 0 ? total : 0, jobPostings: Array.from({ length: count }, (_, i) => posting(offset + i)) });
  };

  it("reads every page and reports a complete list when it fits under the cap", async () => {
    stubFetch(pages(45));
    const list = await ADAPTERS.workday.list(source, signal);
    expect(list).toHaveLength(45);
    expect(list.incomplete).toBe(false);
  });

  it("reports an incomplete list when the site has more jobs than the cap", async () => {
    stubFetch(pages(500));
    const list = await ADAPTERS.workday.list(source, signal);
    expect(list).toHaveLength(200);
    expect(list.incomplete).toBe(true);
  });

  it("fails the whole source when a page cannot be read", async () => {
    stubFetch((url, init) => {
      const { offset } = JSON.parse(String(init?.body));
      return offset === 40 ? json({}, 404) : pages(100)(url, init);
    });
    await expect(ADAPTERS.workday.list(source, signal)).rejects.toThrow();
  });
});

describe("oracle adapter", () => {
  const source: FreeJobSource = { id: "o", employer: "O", adapter: "oracle", host: "o.example.com", site: "CX" };
  const requisitions = (total: number, postedDate: () => string) => (url: string) => {
    const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? 0);
    const count = Math.max(0, Math.min(100, total - offset));
    return json({
      items: [
        {
          TotalJobsCount: total,
          requisitionList: Array.from({ length: count }, (_, i) => ({
            Id: String(offset + i),
            Title: "Manager",
            PrimaryLocation: "Abu Dhabi",
            PostedDate: postedDate(),
          })),
        },
      ],
    });
  };

  it("is complete when the site ends before the cap", async () => {
    stubFetch(requisitions(150, recent));
    const list = await ADAPTERS.oracle.list(source, signal);
    expect(list).toHaveLength(150);
    expect(list.incomplete).toBe(false);
  });

  it("is incomplete when recent jobs run past the cap", async () => {
    stubFetch(requisitions(1000, recent));
    const list = await ADAPTERS.oracle.list(source, signal);
    expect(list).toHaveLength(300);
    expect(list.incomplete).toBe(true);
  });

  it("is complete when it stops because the rest are older than the window", async () => {
    const old = () => new Date(Date.now() - 120 * 86_400_000).toISOString();
    stubFetch(requisitions(1000, old));
    const list = await ADAPTERS.oracle.list(source, signal);
    expect(list).toHaveLength(100);
    expect(list.incomplete).toBe(false);
  });
});

describe("smartrecruiters adapter", () => {
  const source: FreeJobSource = { id: "s", employer: "S", adapter: "smartrecruiters", companyId: "Acme" };
  const postings = (total: number) => (url: string) => {
    const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? 0);
    const count = Math.max(0, Math.min(100, total - offset));
    return json({
      totalFound: total,
      content: Array.from({ length: count }, (_, i) => ({
        id: String(offset + i),
        name: "Manager",
        location: { city: "Abu Dhabi", country: "ae" },
        releasedDate: recent(),
      })),
    });
  };

  it("is complete when the site has fewer postings than the cap", async () => {
    stubFetch(postings(120));
    const list = await ADAPTERS.smartrecruiters.list(source, signal);
    expect(list).toHaveLength(120);
    expect(list.incomplete).toBe(false);
  });

  it("is incomplete when the site has more postings than the cap", async () => {
    stubFetch(postings(900));
    const list = await ADAPTERS.smartrecruiters.list(source, signal);
    expect(list).toHaveLength(500);
    expect(list.incomplete).toBe(true);
  });
});
