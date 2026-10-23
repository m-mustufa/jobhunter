import { describe, expect, it } from "vitest";

import { htmlToText, mapWithConcurrency } from "@/lib/freeJobs/http";

describe("htmlToText", () => {
  it("keeps paragraph and bullet breaks", () => {
    const text = htmlToText("<p>Role</p><ul><li>One</li><li>Two</li></ul>");
    expect(text).toBe("Role\n• One\n• Two");
  });

  it("reads HTML that arrives entity-encoded", () => {
    expect(htmlToText("&lt;p&gt;Hello&lt;/p&gt;")).toBe("Hello");
  });

  it("returns an empty string for nothing", () => {
    expect(htmlToText("")).toBe("");
  });
});

describe("mapWithConcurrency", () => {
  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const { results, failed } = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 2;
    });
    expect(peak).toBe(2);
    expect(failed).toBe(0);
    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it("skips a failed item and counts it", async () => {
    const { results, failed } = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(failed).toBe(1);
    expect(results.sort()).toEqual([1, 3]);
  });
});
