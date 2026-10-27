import { afterEach, describe, expect, it, vi } from "vitest";

import { ADAPTERS } from "@/lib/freeJobs/adapters";
import type { FreeJobSource, JobCandidate } from "@/lib/freeJobs/types";

// The other six career-site adapters, against fake responses shaped like the
// real ones. If a site changes its format, these show which adapter to look at.

const signal = new AbortController().signal;
const recent = () => new Date().toISOString();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (body: string, status = 200) => new Response(body, { status });

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const candidate = (externalId: string, applyLink = "https://example.com/job"): JobCandidate => ({
  externalId,
  title: "Manager",
  location: "Abu Dhabi",
  applyLink,
  postedAt: null,
});

afterEach(() => vi.unstubAllGlobals());

describe("greenhouse adapter", () => {
  const source: FreeJobSource = { id: "g", employer: "G", adapter: "greenhouse", slug: "acme" };

  it("maps each job with its full description", async () => {
    const fetchMock = stubFetch(() =>
      json({
        jobs: [
          {
            id: 1234,
            title: "Head of Finance",
            location: { name: "Abu Dhabi, UAE" },
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1234",
            first_published: "2026-10-20T08:00:00Z",
            content: "<p>Lead the finance team.</p><ul><li>Budgeting</li></ul>",
          },
        ],
      })
    );
    const list = await ADAPTERS.greenhouse.list(source, signal);
    expect(fetchMock.mock.calls[0][0]).toContain("/boards/acme/jobs?content=true");
    expect(list).toEqual([
      expect.objectContaining({
        externalId: "1234",
        title: "Head of Finance",
        location: "Abu Dhabi, UAE",
        applyLink: "https://boards.greenhouse.io/acme/jobs/1234",
        postedAt: "2026-10-20T08:00:00.000Z",
      }),
    ]);
    expect(list[0].description).toContain("Lead the finance team.");
    expect(list[0].description).toContain("Budgeting");
    expect(list[0].description).not.toContain("<p>");
  });

  it("returns an empty list for a board with no jobs and fails when the board is gone", async () => {
    stubFetch(() => json({}));
    expect(await ADAPTERS.greenhouse.list(source, signal)).toHaveLength(0);
    stubFetch(() => json({ error: "not found" }, 404));
    await expect(ADAPTERS.greenhouse.list(source, signal)).rejects.toThrow(/404/);
  });
});

describe("lever adapter", () => {
  const source: FreeJobSource = { id: "l", employer: "L", adapter: "lever", slug: "aldar" };
  const page = `
    <div class="postings-group">
      <div class="posting">
        <a class="posting-title" href="https://jobs.lever.co/aldar/aaaa-1111">
          <h5 data-qa="posting-name">Director of Strategy</h5>
          <div class="posting-categories"><span class="location">Abu Dhabi</span></div>
        </a>
      </div>
      <div class="posting">
        <a class="posting-title" href="https://jobs.lever.co/aldar/bbbb-2222/">
          <h5 data-qa="posting-name">Head of Sales</h5>
          <div class="posting-categories"><span class="location">Dubai</span></div>
        </a>
      </div>
      <div class="posting"><a class="posting-title" href=""><h5 data-qa="posting-name"></h5></a></div>
    </div>`;

  it("reads postings from the public jobs page and skips broken ones", async () => {
    stubFetch(() => text(page));
    const list = await ADAPTERS.lever.list(source, signal);
    expect(list.map((job) => [job.externalId, job.title, job.location])).toEqual([
      ["aaaa-1111", "Director of Strategy", "Abu Dhabi"],
      ["bbbb-2222", "Head of Sales", "Dubai"],
    ]);
    expect(list[0].applyLink).toBe("https://jobs.lever.co/aldar/aaaa-1111");
  });

  it("fails rather than reporting an empty board, so saved jobs are not wiped", async () => {
    stubFetch(() => text("<html><body>Layout changed</body></html>"));
    await expect(ADAPTERS.lever.list(source, signal)).rejects.toThrow(/no postings/);
  });

  it("builds the description from the plain text, the lists and the closing text", async () => {
    stubFetch(() =>
      json({
        descriptionPlain: "Lead the function.",
        lists: [{ text: "Requirements", content: "<li>10 years</li><li>MBA</li>" }],
        additionalPlain: "Equal opportunity employer.",
        createdAt: Date.UTC(2026, 9, 20),
      })
    );
    const detail = await ADAPTERS.lever.hydrate!(source, candidate("aaaa-1111"), signal);
    expect(detail.description).toContain("Lead the function.");
    expect(detail.description).toContain("Requirements");
    expect(detail.description).toContain("10 years");
    expect(detail.description).toContain("Equal opportunity employer.");
    expect(detail.postedAt).toBe("2026-10-20T00:00:00.000Z");
  });

  it("falls back to the HTML fields when the plain ones are empty", async () => {
    stubFetch(() => json({ descriptionPlain: "", description: "<p>Own the budget.</p>", createdAt: null }));
    const detail = await ADAPTERS.lever.hydrate!(source, candidate("x"), signal);
    expect(detail.description).toContain("Own the budget.");
    expect(detail.postedAt).toBeNull();
  });
});

describe("phenom adapter", () => {
  const source: FreeJobSource = { id: "p", employer: "P", adapter: "phenom", host: "jobs.example.ae", locale: "us/en" };
  const hits = (total: number) => (_url: string, init?: RequestInit) => {
    const { from } = JSON.parse(String(init?.body));
    const count = Math.max(0, Math.min(100, total - from));
    return json({
      refineSearch: {
        totalHits: total,
        data: {
          jobs: Array.from({ length: count }, (_, i) => ({
            reqId: `R${from + i}`,
            title: "Manager",
            location: "Abu Dhabi",
            postedDate: recent(),
          })),
        },
      },
    });
  };

  it("maps jobs and is complete when the site ends before the cap", async () => {
    stubFetch(hits(120));
    const list = await ADAPTERS.phenom.list(source, signal);
    expect(list).toHaveLength(120);
    expect(list.incomplete).toBe(false);
    expect(list[0]).toMatchObject({ externalId: "R0", applyLink: "https://jobs.example.ae/us/en/job/R0" });
  });

  it("is incomplete when the site has more postings than the cap", async () => {
    stubFetch(hits(900));
    const list = await ADAPTERS.phenom.list(source, signal);
    expect(list).toHaveLength(500);
    expect(list.incomplete).toBe(true);
  });

  it("reads the description from the page's JobPosting data, including inside @graph", async () => {
    const posting = { "@type": "JobPosting", description: "<p>Run the programme.</p>", datePosted: "2026-10-18" };
    const html = (data: unknown) => `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`;

    stubFetch(() => text(html(posting)));
    const direct = await ADAPTERS.phenom.hydrate!(source, candidate("R1"), signal);
    expect(direct.description).toBe("Run the programme.");
    expect(direct.postedAt).toBe("2026-10-18T00:00:00.000Z");

    stubFetch(() => text(html({ "@graph": [{ "@type": "WebSite" }, posting] })));
    const graph = await ADAPTERS.phenom.hydrate!(source, candidate("R1"), signal);
    expect(graph.description).toBe("Run the programme.");
  });

  it("returns no description when the page has no usable JobPosting", async () => {
    stubFetch(() => text(`<html><script type="application/ld+json">{ broken</script></html>`));
    const detail = await ADAPTERS.phenom.hydrate!(source, { ...candidate("R1"), postedAt: "2026-10-01T00:00:00.000Z" }, signal);
    expect(detail.description).toBe("");
    expect(detail.postedAt).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("workable adapter", () => {
  const source: FreeJobSource = { id: "w", employer: "W", adapter: "workable", account: "adia" };
  const job = (n: number) => ({
    shortcode: `SC${n}`,
    title: "Manager",
    location: { city: "Abu Dhabi", country: "United Arab Emirates" },
    published: recent(),
  });

  it("follows the page token until the account has no more pages", async () => {
    const tokens: Array<string | undefined> = [];
    stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      tokens.push(body.token);
      return body.token ? json({ results: [job(3)] }) : json({ results: [job(1), job(2)], nextPage: "t2" });
    });
    const list = await ADAPTERS.workable.list(source, signal);
    expect(tokens).toEqual([undefined, "t2"]);
    expect(list.map((entry) => entry.externalId)).toEqual(["SC1", "SC2", "SC3"]);
    expect(list.incomplete).toBe(false);
    expect(list[0]).toMatchObject({
      location: "Abu Dhabi, United Arab Emirates",
      applyLink: "https://apply.workable.com/adia/j/SC1/",
    });
  });

  it("is incomplete when the account keeps offering pages past the cap", async () => {
    stubFetch(() => json({ results: [job(1)], nextPage: "more" }));
    const list = await ADAPTERS.workable.list(source, signal);
    expect(list).toHaveLength(5);
    expect(list.incomplete).toBe(true);
  });

  it("joins the description, requirements and benefits", async () => {
    stubFetch(() =>
      json({ description: "<p>About the role.</p>", requirements: "<p>Ten years.</p>", benefits: "" })
    );
    const detail = await ADAPTERS.workable.hydrate!(source, candidate("SC1"), signal);
    expect(detail.description).toBe("About the role.\n\nTen years.");
  });
});

describe("eightfold adapter", () => {
  const source: FreeJobSource = { id: "e", employer: "E", adapter: "eightfold", host: "jobs.example.com", domain: "example.com" };
  const positions = (total: number, postedTs: (n: number) => number) => (url: string) => {
    const start = Number(/[?&]start=(\d+)/.exec(url)?.[1] ?? 0);
    const count = Math.max(0, Math.min(10, total - start));
    return json({
      data: {
        count: total,
        positions: Array.from({ length: count }, (_, i) => ({
          id: start + i + 1,
          name: "Manager",
          locations: ["Abu Dhabi, United Arab Emirates", "Dubai"],
          positionUrl: `/careers/job/${start + i + 1}`,
          postedTs: postedTs(start + i),
        })),
      },
    });
  };
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it("maps positions, turning the seconds timestamp into a date", async () => {
    const posted = nowSeconds() - 3600;
    const fetchMock = stubFetch(positions(25, () => posted));
    const list = await ADAPTERS.eightfold.list(source, signal);
    expect(list).toHaveLength(25);
    expect(list.incomplete).toBe(false);
    expect(list[0]).toMatchObject({
      externalId: "1",
      location: "Abu Dhabi, United Arab Emirates | Dubai",
      applyLink: "https://jobs.example.com/careers/job/1",
      postedAt: new Date(posted * 1000).toISOString(),
    });
    expect(fetchMock.mock.calls[0][0]).toContain("domain=example.com");
    expect(fetchMock.mock.calls[0][0]).toContain("query=Abu+Dhabi");
  });

  it("is incomplete when recent positions run past the cap", async () => {
    stubFetch(positions(1000, nowSeconds));
    const list = await ADAPTERS.eightfold.list(source, signal);
    expect(list).toHaveLength(200);
    expect(list.incomplete).toBe(true);
  });

  it("is complete when it stops because the rest are older than the window", async () => {
    const old = () => nowSeconds() - 120 * 86_400;
    stubFetch(positions(1000, old));
    const list = await ADAPTERS.eightfold.list(source, signal);
    expect(list).toHaveLength(10);
    expect(list.incomplete).toBe(false);
  });

  it("reads the description from the position details", async () => {
    const fetchMock = stubFetch(() => json({ data: { jobDescription: "<p>Lead delivery.</p>" } }));
    const detail = await ADAPTERS.eightfold.hydrate!(source, candidate("7"), signal);
    expect(detail.description).toBe("Lead delivery.");
    expect(fetchMock.mock.calls[0][0]).toContain("position_id=7");
  });
});

describe("successfactors adapter", () => {
  const source: FreeJobSource = { id: "s", employer: "S", adapter: "successfactors", host: "careers.example.ae" };
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://careers.example.ae/</loc></url>
    <url><loc>https://careers.example.ae/job/Abu-Dhabi-Senior-Manager-Finance/1001/</loc></url>
    <url><loc>https://careers.example.ae/job/Dubai-Head-of-Sales/1002/</loc></url>
    <url><loc>https://careers.example.ae/job/Abu-Dhabi-Director-R%26D/1003/?a=1&amp;b=2</loc></url>
    <url><loc>https://careers.example.ae/job/only-a-slug</loc></url>
  </urlset>`;

  it("finds postings in the sitemap and leaves their location for the page", async () => {
    stubFetch(() => text(sitemap));
    const list = await ADAPTERS.successfactors.list(source, signal);
    expect(list.map((job) => job.externalId)).toEqual(["1001", "1002", "1003"]);
    expect(list[0]).toMatchObject({
      title: "Abu Dhabi Senior Manager Finance",
      location: "",
      locationUnknown: true,
      postedAt: null,
    });
    expect(list[2].title).toBe("Abu Dhabi Director R&D");
  });

  it("reads the real title, location, date and description from the posting page", async () => {
    stubFetch(() =>
      text(`<html>
        <meta itemprop="addressLocality" content="Abu Dhabi">
        <meta itemprop="addressCountry" content="AE">
        <meta itemprop="datePosted" content="2026-10-15">
        <span itemprop="title"> Senior Manager, Finance </span>
        <div itemprop="description"><p>Lead the finance function.</p></div>
      </html>`)
    );
    const detail = await ADAPTERS.successfactors.hydrate!(source, candidate("1001"), signal);
    expect(detail).toMatchObject({
      title: "Senior Manager, Finance",
      location: "Abu Dhabi, United Arab Emirates",
      postedAt: "2026-10-15T00:00:00.000Z",
    });
    expect(detail.description).toBe("Lead the finance function.");
  });

  it("copes with a site that puts the city and country code in the street address", async () => {
    stubFetch(() =>
      text(`<html>
        <meta itemprop="streetAddress" content="Abu Dhabi, AE">
        <meta itemprop="addressCountry" content="AE">
        <div itemprop="description"><p>Text.</p></div>
      </html>`)
    );
    const detail = await ADAPTERS.successfactors.hydrate!(source, candidate("1001"), signal);
    expect(detail.location).toBe("Abu Dhabi, United Arab Emirates");
    // No title on the page: the one from the sitemap is kept.
    expect(detail.title).toBe("Manager");
  });

  it("does not repeat the country when the locality already holds it", async () => {
    stubFetch(() =>
      text(`<html>
        <meta itemprop="addressLocality" content="United Arab Emirates">
        <meta itemprop="addressCountry" content="AE">
        <div itemprop="description"><p>Text.</p></div>
      </html>`)
    );
    const detail = await ADAPTERS.successfactors.hydrate!(source, candidate("1001"), signal);
    expect(detail.location).toBe("United Arab Emirates");
  });
});
