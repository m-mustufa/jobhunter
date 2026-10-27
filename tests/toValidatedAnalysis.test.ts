import { describe, expect, it, vi } from "vitest";

import { TailoringQualityError, toValidatedAnalysis } from "@/lib/analyzeJob";
import { SOURCE, baseReply, job, profile } from "./fixtures/cv";

// The full reply check, end to end, on a small made-up CV and vacancy. Quality
// shortfalls (a near-copy, an uncovered top requirement, a long highlight) are
// kept; anything that could make the CV claim something untrue is sent back.

const run = (reply: any) => toValidatedAnalysis(reply, profile, job);
const issuesOf = (reply: any): string[] => {
  try {
    run(reply);
  } catch (error) {
    if (error instanceof TailoringQualityError) return error.issues;
    throw error;
  }
  return [];
};

describe("toValidatedAnalysis", () => {
  it("accepts a well-formed, evidence-backed reply", () => {
    expect(issuesOf(baseReply())).toEqual([]);
    const analysis = run(baseReply());
    expect(analysis.tailoredCV.experience[0].bullets).toHaveLength(3);
    expect(analysis.tailoredCV.experience[0].bullets[0]).toContain("Directed quality inspectors");
  });

  describe("quality shortfalls are kept, not sent back", () => {
    it("keeps a highlight that is a near-copy of its source bullet", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const reply = baseReply();
      reply.experienceRewrites[0].tailoredHighlights[2].text = SOURCE[0][2];
      expect(issuesOf(reply)).toEqual([]);
      expect(run(reply).tailoredCV.experience[0].bullets).toContain(SOURCE[0][2]);
    });

    it("keeps a reply whose top requirements no highlight is tagged with", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const reply = baseReply();
      reply.experienceRewrites.forEach((rewrite: any) =>
        rewrite.tailoredHighlights.forEach((highlight: any) => (highlight.requirementIds = []))
      );
      expect(issuesOf(reply)).toEqual([]);
    });

    it("keeps a reply whose own requirement label is not worded like the vacancy", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const reply = baseReply();
      // A ranked requirement is analysis metadata; it never appears in the CV.
      reply.rankedRequirements[5].requirement = "Operate rocket thrusters in low orbit";
      expect(issuesOf(reply)).toEqual([]);
    });

    it("keeps a long highlight and never cuts it", () => {
      const reply = baseReply();
      const long =
        "Directed quality inspectors during supplier audits spanning multiple manufacturing sites, " +
        "and kept the work on schedule while the audits continued across each of those sites, with the team working through the same supplier audits " +
        "site by site until every supplier audit had been completed by the quality inspectors across the multiple manufacturing sites. ".repeat(2);
      expect(long.length).toBeGreaterThan(420);
      reply.experienceRewrites[0].tailoredHighlights[0].text = long;
      expect(issuesOf(reply)).toEqual([]);
      const bullets = run(reply).tailoredCV.experience[0].bullets;
      expect(bullets.some((bullet) => bullet.length === long.trim().length)).toBe(true);
    });
  });

  describe("anything that could make the CV untrue is still sent back", () => {
    it("rejects a highlight of absurd length", () => {
      const reply = baseReply();
      reply.experienceRewrites[0].tailoredHighlights[0].text = "Directed quality inspectors during supplier audits. ".repeat(30);
      expect(issuesOf(reply).join(" ")).toMatch(/characters; keep every highlight under/);
    });

    it("rejects a number the evidence does not contain", () => {
      const reply = baseReply();
      reply.experienceRewrites[0].tailoredHighlights[2].text =
        "Created a supplier scorecard that lifted on-time delivery by 40% and cut repeat defects.";
      expect(issuesOf(reply).join(" ")).toMatch(/unsupported numeric evidence/);
    });

    it("rejects an ownership upgrade and names the sentence, the verb and what to write instead", () => {
      const reply = baseReply();
      reply.experienceRewrites[1].tailoredHighlights[0].text =
        "Led contractor welding checks against approved procedures. Logged every non-conformance.";
      const [issue] = issuesOf(reply).filter((text) => /upgrades ownership/.test(text));
      expect(issue).toBeDefined();
      expect(issue).toContain('"Led contractor welding checks against approved procedures."');
      expect(issue).toContain('says "Led"');
      expect(issue).toMatch(/same level of involvement as the source/);
      // The sentence that was fine is not blamed.
      expect(issue).not.toContain("Logged every non-conformance");
    });

    it("rejects an unsupported qualification and quotes the sentence", () => {
      const reply = baseReply();
      reply.experienceRewrites[1].tailoredHighlights[2].text =
        "Coached junior engineers on inspection methods. Brings a certified approach to documentation standards.";
      const [issue] = issuesOf(reply).filter((text) => /unsupported qualification/.test(text));
      expect(issue).toBeDefined();
      expect(issue).toContain("Brings a certified approach to documentation standards.");
    });

    it("rejects a tool or standard the evidence does not contain", () => {
      const reply = baseReply();
      reply.experienceRewrites[1].tailoredHighlights[2].text =
        "Coached junior engineers on inspection methods and documentation standards using SAP and ISO 9001.";
      expect(issuesOf(reply).length).toBeGreaterThan(0);
    });

    it("rejects a reply that leaves a source bullet out of every highlight", () => {
      const reply = baseReply();
      reply.experienceRewrites[0].tailoredHighlights.pop();
      expect(issuesOf(reply).length).toBeGreaterThan(0);
    });

    it("rejects a changed employer name", () => {
      const reply = baseReply();
      reply.experienceRewrites[1].company = "Globex Group Holdings";
      expect(issuesOf(reply).length).toBeGreaterThan(0);
    });

    it("rejects a skills list that is not just a reordering", () => {
      const reply = baseReply();
      reply.skillsOrder = [0, 1, 2];
      expect(issuesOf(reply).length).toBeGreaterThan(0);
    });
  });
});
