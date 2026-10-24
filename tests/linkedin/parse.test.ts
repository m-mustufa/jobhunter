import { describe, expect, it } from "vitest";

import { parseLinkedInDescriptionHtml, parseLinkedInSearchHtml, searchUrl } from "@/lib/linkedinJobs.server";

// Markup as LinkedIn's public search returns it (class names are the stable part).
const card = (id: string, title: string, company: string, location: string, date: string | null) => `
<li><div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:${id}">
  <a class="base-card__full-link" href="https://ae.linkedin.com/jobs/view/some-slug-${id}?position=1&amp;pageNum=0"></a>
  <div class="base-search-card__info">
    <h3 class="base-search-card__title">
      ${title}
    </h3>
    <h4 class="base-search-card__subtitle"><a class="hidden-nested-link">${company}</a></h4>
    <div class="base-search-card__metadata">
      <span class="job-search-card__location">${location}</span>
      ${date ? `<time class="job-search-card__listdate" datetime="${date}">3 days ago</time>` : ""}
    </div>
  </div>
</div></li>`;

describe("parseLinkedInSearchHtml", () => {
  it("reads id, title, company, location, date and link from a card", () => {
    const [job] = parseLinkedInSearchHtml(
      card("4480648429", "Director of Human Resources", "Saadiyat Rotana Resort &amp; Villas", "Abu Dhabi, Abu Dhabi Emirate, United Arab Emirates", "2026-10-21")
    );
    expect(job).toEqual({
      id: "4480648429",
      title: "Director of Human Resources",
      company: "Saadiyat Rotana Resort & Villas",
      location: "Abu Dhabi, Abu Dhabi Emirate, United Arab Emirates",
      applyLink: "https://www.linkedin.com/jobs/view/4480648429",
      postedIso: "2026-10-21",
    });
  });

  it("keeps an Abu Dhabi emirate location without the city name", () => {
    const jobs = parseLinkedInSearchHtml(
      card("1111111111", "Head of Finance", "ADNOC", "Abu Dhabi Emirate, United Arab Emirates", "2026-10-20")
    );
    expect(jobs).toHaveLength(1);
  });

  it("drops cards outside Abu Dhabi, with non-target titles, or missing fields", () => {
    const html =
      card("2222222222", "Director of Sales", "Acme", "Dubai, United Arab Emirates", "2026-10-20") +
      card("3333333333", "Sales Executive", "Acme", "Abu Dhabi, United Arab Emirates", "2026-10-20") +
      card("4444444444", "Operations Manager", "", "Abu Dhabi, United Arab Emirates", "2026-10-20");
    expect(parseLinkedInSearchHtml(html)).toEqual([]);
  });

  it("returns a card with no date as undated, so it can be filtered later", () => {
    const [job] = parseLinkedInSearchHtml(
      card("5555555555", "Operations Manager", "Acme", "Abu Dhabi, United Arab Emirates", null)
    );
    expect(job.postedIso).toBeNull();
  });

  it("returns nothing for an empty or unrelated page", () => {
    expect(parseLinkedInSearchHtml("")).toEqual([]);
    expect(parseLinkedInSearchHtml("<html><body>Please sign in</body></html>")).toEqual([]);
  });
});

describe("parseLinkedInDescriptionHtml", () => {
  it("turns the posting into readable text with bullets", () => {
    const text = parseLinkedInDescriptionHtml(`
      <div class="description__text"><div class="show-more-less-html__markup">
        <p>Lead the finance team.</p><ul><li>Own the budget</li><li>Report to the CFO</li></ul>
      </div></div>`);
    expect(text).toContain("Lead the finance team.");
    expect(text).toContain("- Own the budget");
    expect(text).toContain("- Report to the CFO");
  });

  it("returns an empty string when the description block is missing", () => {
    expect(parseLinkedInDescriptionHtml("<html></html>")).toBe("");
  });
});

describe("searchUrl", () => {
  it("searches by Abu Dhabi's id, newest first, over the past month", () => {
    const url = new URL(searchUrl('("Director" OR "Head of")', 10));
    expect(url.pathname).toBe("/jobs-guest/jobs/api/seeMoreJobPostings/search");
    expect(url.searchParams.get("geoId")).toBe("104524176");
    expect(url.searchParams.get("keywords")).toBe('("Director" OR "Head of")');
    expect(url.searchParams.get("f_TPR")).toBe("r2592000");
    expect(url.searchParams.get("sortBy")).toBe("DD");
    expect(url.searchParams.get("start")).toBe("10");
    // The text `location` is ignored by newer LinkedIn pages and picks the visitor's own city.
    expect(url.searchParams.has("location")).toBe(false);
  });
});
