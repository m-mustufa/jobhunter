import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LINKEDIN_QUERIES, crawlLinkedInCards, fetchLinkedInJobDescription } from "@/lib/linkedinJobs.server";

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
async function crawl() {
  const promise = crawlLinkedInCards();
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
  it("makes one request per role family and collects the cards", async () => {
    stubFetch((url) => page([`1${LINKEDIN_QUERIES.indexOf(url.searchParams.get("keywords") || "")}00000000`]));
    const result = await crawl();
    expect(requests).toHaveLength(LINKEDIN_QUERIES.length);
    expect(result.cards).toHaveLength(LINKEDIN_QUERIES.length);
    expect(result.blocked).toBe(false);
    expect(result.failedRequests).toBe(0);
    for (const url of requests) expect(new URL(url).searchParams.get("geoId")).toBe("104524176");
  });

  it("reads a second page only for families whose first page was well filled", async () => {
    const ids = (offset: number, n: number) => Array.from({ length: n }, (_, i) => `${9000000000 + offset + i}`);
    stubFetch((url, index) =>
      url.searchParams.get("start") === "10"
        ? page(ids(500 + index * 10, 3))
        : index === 0
          ? page(ids(0, 10))
          : page(ids(index * 100, 2))
    );
    const result = await crawl();
    const secondPages = requests.filter((url) => new URL(url).searchParams.get("start") === "10");
    expect(secondPages).toHaveLength(1);
    expect(result.cards.length).toBeGreaterThan(LINKEDIN_QUERIES.length);
  });

  it("stops at the first 429 and keeps what it had read", async () => {
    stubFetch((_url, index) => (index < 2 ? page([`77000000${index}`]) : new Response("slow down", { status: 429 })));
    const result = await crawl();
    expect(result.blocked).toBe(true);
    expect(result.cards).toHaveLength(2);
    // Requests 0 and 1 worked, request 2 was refused, and nothing was sent after it.
    expect(requests).toHaveLength(3);
    expect(result.failedRequests).toBe(1);
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

  it("throws when the network is down, instead of returning an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(crawl()).rejects.toThrow("offline");
  });

  it("never sends more requests than its cap", async () => {
    stubFetch((_url, index) => page(Array.from({ length: 10 }, (_, i) => `${6000000000 + index * 10 + i}`)));
    await crawl();
    expect(requests.length).toBeLessThanOrEqual(18);
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
