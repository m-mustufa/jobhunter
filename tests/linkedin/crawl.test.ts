import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LINKEDIN_QUERIES,
  LINKEDIN_SLOTS,
  crawlLinkedInCards,
  fetchLinkedInJobDescription,
} from "@/lib/linkedinJobs.server";

const today = () => new Date().toISOString().slice(0, 10);

const cardHtml = (id: string, title = "Operations Manager") => `
<li><div data-entity-urn="urn:li:jobPosting:${id}">
  <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/x-${id}"></a>
  <h3 class="base-search-card__title">${title}</h3>
  <h4 class="base-search-card__subtitle"><a>Acme</a></h4>
  <span class="job-search-card__location">Abu Dhabi, United Arab Emirates</span>
  <time datetime="${today()}">today</time>
</div></li>`;

const page = (ids: string[]) => new Response(ids.map((id) => cardHtml(id)).join(""), { status: 200 });

let requests: string[];
function stubFetch(handler: (url: URL, index: number) => Response) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      return handler(url, requests.length - 1);
    })
  );
}

// The crawl pauses between requests; fake only the timers so the test does not wait.
async function crawl(cursor = 0) {
  const promise = crawlLinkedInCards(undefined, cursor);
  const settled = promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("crawlLinkedInCards", () => {
  const slotOf = (url: string) => {
    const params = new URL(url).searchParams;
    return LINKEDIN_SLOTS.findIndex(
      (slot) => slot.query === params.get("keywords") && String(slot.start) === params.get("start")
    );
  };

  it("lists every role family's first page before any second page", () => {
    const families = LINKEDIN_QUERIES.length;
    expect(LINKEDIN_SLOTS).toHaveLength(families * 2);
    expect(LINKEDIN_SLOTS.slice(0, families).every((slot) => slot.start === 0)).toBe(true);
    expect(LINKEDIN_SLOTS.slice(families).every((slot) => slot.start === 10)).toBe(true);
  });

  it("reads only the next few searches, one request each, and says where to carry on", async () => {
    stubFetch((_url, index) => page([`10000000${index}`]));
    const result = await crawl(0);
    expect(requests).toHaveLength(4);
    expect(requests.map(slotOf)).toEqual([0, 1, 2, 3]);
    expect(result.cards).toHaveLength(4);
    expect(result.slotsRead).toBe(4);
    expect(result.totalSlots).toBe(LINKEDIN_SLOTS.length);
    expect(result.nextCursor).toBe(4);
    expect(result.blocked).toBe(false);
    for (const url of requests) expect(new URL(url).searchParams.get("geoId")).toBe("104524176");
  });

  it("carries on from the cursor and wraps around the end of the cycle", async () => {
    stubFetch((_url, index) => page([`20000000${index}`]));
    const start = LINKEDIN_SLOTS.length - 2;
    const result = await crawl(start);
    expect(requests.map(slotOf)).toEqual([start, start + 1, 0, 1]);
    expect(result.nextCursor).toBe(2);
  });

  it("covers the whole cycle over successive syncs", async () => {
    stubFetch((_url, index) => page([`3000000${index}`]));
    const seen = new Set<number>();
    let cursor = 0;
    for (let sync = 0; sync < 5; sync += 1) {
      requests = [];
      const result = await crawl(cursor);
      requests.map(slotOf).forEach((slot) => seen.add(slot));
      cursor = result.nextCursor;
    }
    expect(seen.size).toBe(LINKEDIN_SLOTS.length);
  });

  it("stops at the first 429, keeps what it read, and retries that search next time", async () => {
    stubFetch((_url, index) => (index < 2 ? page([`77000000${index}`]) : new Response("slow down", { status: 429 })));
    const result = await crawl(0);
    expect(result.blocked).toBe(true);
    expect(result.cards).toHaveLength(2);
    // Requests 0 and 1 worked, request 2 was refused, and nothing was sent after it.
    expect(requests).toHaveLength(3);
    expect(result.failedRequests).toBe(1);
    expect(result.slotsRead).toBe(2);
    expect(result.nextCursor).toBe(2);
  });

  it("treats LinkedIn's 999 and 403 as a block too", async () => {
    for (const status of [999, 403]) {
      // `new Response` refuses a status of 999, which a real network response can carry.
      const refused = { status, ok: false, text: async () => "" } as unknown as Response;
      stubFetch((_url, index) => (index === 0 ? page(["880000000"]) : refused));
      const result = await crawl();
      expect(result.blocked, String(status)).toBe(true);
    }
  });

  it("throws when LinkedIn blocks the very first request", async () => {
    stubFetch(() => new Response("", { status: 429 }));
    await expect(crawl()).rejects.toThrow(/blocked/i);
    expect(requests).toHaveLength(1);
  });

  it("skips a search that fails for another reason, so the cursor never sticks on it", async () => {
    stubFetch((_url, index) => (index === 1 ? new Response("oops", { status: 500 }) : page([`4000000${index}`])));
    const result = await crawl(0);
    expect(result.blocked).toBe(false);
    expect(result.failedRequests).toBe(1);
    expect(result.nextCursor).toBeGreaterThanOrEqual(3);
    expect(result.cards.length).toBeGreaterThanOrEqual(2);
  });

  it("throws when the network is down, instead of returning an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(crawl()).rejects.toThrow("offline");
  });

  it("returns an empty list, not an error, when LinkedIn answers with no matching jobs", async () => {
    stubFetch(() => new Response("<html></html>", { status: 200 }));
    const result = await crawl();
    expect(result.cards).toEqual([]);
    expect(result.slotsRead).toBe(4);
  });

  it("never sends more than four requests in one sync", async () => {
    stubFetch((_url, index) => page(Array.from({ length: 10 }, (_, i) => `${6000000000 + index * 10 + i}`)));
    await crawl();
    expect(requests.length).toBe(4);
  });

  it("drops cards older than a month", async () => {
    stubFetch(() =>
      new Response(
        cardHtml("5000000001").replace(today(), "2024-01-01") + cardHtml("5000000002"),
        { status: 200 }
      )
    );
    const result = await crawl();
    expect(result.cards.map((card) => card.id)).toEqual(["5000000002"]);
  });
});

describe("fetchLinkedInJobDescription", () => {
  it("rejects an id that is not numeric without calling LinkedIn", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    await expect(fetchLinkedInJobDescription("../etc")).rejects.toThrow("Invalid");
    expect(requests).toHaveLength(0);
  });

  it("returns the description and then serves it from cache", async () => {
    stubFetch(
      () =>
        new Response('<div class="description__text"><div class="show-more-less-html__markup"><p>Lead the team.</p></div></div>', {
          status: 200,
        })
    );
    expect(await fetchLinkedInJobDescription("4480648429")).toContain("Lead the team.");
    expect(await fetchLinkedInJobDescription("4480648429")).toContain("Lead the team.");
    expect(requests).toHaveLength(1);
  });
});
