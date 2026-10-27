import { describe, expect, it } from "vitest";

import { getJobRecommendation } from "@/lib/jobRecommendation";
import { getMatchTier } from "@/lib/matchTier";
import type { Job } from "@/lib/types";
import { job as vacancy, profile } from "./fixtures/cv";

// "Recommended" is the one positive marker on a listing. It is scored locally
// from the profile and the job's full text, so it needs to stay predictable.

const listing = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  title: vacancy.title,
  company: vacancy.company,
  location: "Abu Dhabi, United Arab Emirates",
  salary: null,
  description: vacancy.description,
  applyLink: "https://example.com/job-1",
  source: "Test",
  postedAt: "2026-10-20",
  ...overrides,
});

describe("getJobRecommendation", () => {
  it("recommends a job that matches the profile's role, skills and responsibilities", () => {
    const result = getJobRecommendation(profile, listing());
    expect(result.recommended).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("does not recommend an unrelated job", () => {
    const result = getJobRecommendation(
      profile,
      listing({
        title: "Executive Pastry Chef",
        description:
          "Executive Pastry Chef for a luxury hotel kitchen. Responsibilities: create dessert menus, manage the bakery brigade, order flour, chocolate and sugar, and keep the pastry section spotless. Requirements: culinary diploma and ten years in five-star hotels.",
      })
    );
    expect(result.recommended).toBe(false);
    expect(result.score).toBeLessThan(50);
  });

  it("holds back a job whose mandatory qualification the profile does not have", () => {
    const withRequirement = listing({
      description: `${vacancy.description} An ACCA qualification is required for this role.`,
    });
    expect(getJobRecommendation(profile, listing()).recommended).toBe(true);
    const blocked = getJobRecommendation(profile, withRequirement);
    expect(blocked.recommended).toBe(false);
    expect(blocked.score).toBeLessThan(getJobRecommendation(profile, listing()).score);
  });

  it("does not hold back a job that asks for a qualification the profile has", () => {
    const withCert = { ...profile, certifications: ["ACCA"] };
    const withRequirement = listing({
      description: `${vacancy.description} An ACCA qualification is required for this role.`,
    });
    expect(getJobRecommendation(withCert, withRequirement).recommended).toBe(true);
  });

  it("only counts a qualification as missing when the job calls it required", () => {
    const optional = listing({
      description: `${vacancy.description} An ACCA qualification would be a nice extra, but is not part of the day to day.`,
    });
    expect(getJobRecommendation(profile, optional).recommended).toBe(true);
  });

  it("scores a senior role lower for a profile with no leadership evidence", () => {
    const noLeadership = {
      ...profile,
      title: "Quality Engineer",
      summary: "Quality professional with experience in inspections.",
      experience: profile.experience.map((entry) => ({
        ...entry,
        role: "Quality Engineer",
        bullets: entry.bullets.map((bullet) =>
          bullet.replace(/\b(Led|led|Trained|Introduced|Coordinated)\b/g, "Helped with")
        ),
      })),
    };
    const lead = getJobRecommendation(profile, listing());
    const flat = getJobRecommendation(noLeadership, listing());
    expect(flat.score).toBeLessThan(lead.score);
  });

  it("relies on the title alone while a LinkedIn description has not been loaded", () => {
    const placeholder = listing({
      description: "LinkedIn listing for x. The full description will be loaded before tailoring.",
    });
    const result = getJobRecommendation(profile, placeholder);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    // The placeholder text must not count as job content.
    const titleOnly = getJobRecommendation(profile, listing({ description: "" }));
    expect(result).toEqual(titleOnly);
  });

  it("ignores a description that still carries the not-loaded marker, however long it is", () => {
    const marked = listing({
      description: `${vacancy.description} The full description will be loaded before tailoring.`,
    });
    expect(getJobRecommendation(profile, marked)).toEqual(
      getJobRecommendation(profile, listing({ description: "" }))
    );
  });

  it("gives an empty profile no score and no recommendation", () => {
    const empty = {
      ...profile,
      title: "",
      summary: "",
      skills: [],
      experience: [],
      education: [],
      certifications: [],
      languages: [],
    };
    expect(getJobRecommendation(empty, listing())).toEqual({ score: 0, recommended: false });
  });

  it("always returns a whole score between 0 and 100 and is repeatable", () => {
    for (const title of ["Quality Manager", "Head of Quality and Audit", "Cook", ""]) {
      const first = getJobRecommendation(profile, listing({ title }));
      expect(Number.isInteger(first.score)).toBe(true);
      expect(first.score).toBeGreaterThanOrEqual(0);
      expect(first.score).toBeLessThanOrEqual(100);
      expect(getJobRecommendation(profile, listing({ title }))).toEqual(first);
    }
  });
});

describe("getMatchTier", () => {
  it.each([
    [100, "strong"],
    [85, "strong"],
    [84, "good"],
    [70, "good"],
    [69, "partial"],
    [55, "partial"],
    [54, "weak"],
    [0, "weak"],
  ])("puts a score of %i in the %s tier", (score, key) => {
    expect(getMatchTier(score).key).toBe(key);
  });
});
