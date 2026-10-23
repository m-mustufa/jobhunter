import { describe, expect, it } from "vitest";

import {
  isRecent,
  isTargetLocation,
  isTightManagerialTitle,
  passesListCriteria,
} from "@/lib/freeJobs/criteria";

const DAY = 86_400_000;

describe("isTargetLocation", () => {
  it("accepts Abu Dhabi and its regions", () => {
    for (const place of ["Abu Dhabi", "Abu Dhabi, United Arab Emirates", "Al Ain", "Mussafah", "Yas Island, Abu Dhabi"]) {
      expect(isTargetLocation(place), place).toBe(true);
    }
  });

  it("accepts a bare UAE location", () => {
    expect(isTargetLocation("UAE")).toBe(true);
    expect(isTargetLocation("United Arab Emirates")).toBe(true);
  });

  it("rejects other emirates and other countries", () => {
    for (const place of ["Dubai", "Dubai, UAE", "Sharjah, United Arab Emirates", "London", "Riyadh, Saudi Arabia"]) {
      expect(isTargetLocation(place), place).toBe(false);
    }
  });

  it("rejects an empty location", () => {
    expect(isTargetLocation("")).toBe(false);
  });

  it("keeps a job listed in Abu Dhabi even when it also names Dubai", () => {
    expect(isTargetLocation("Abu Dhabi / Dubai")).toBe(true);
  });
});

describe("isTightManagerialTitle", () => {
  it("accepts real management titles", () => {
    for (const title of ["Senior Manager, Finance", "Head of Strategy", "Director of Operations", "VP Engineering", "Chief Financial Officer"]) {
      expect(isTightManagerialTitle(title), title).toBe(true);
    }
  });

  it("accepts a lead role that is not an individual-contributor one", () => {
    expect(isTightManagerialTitle("Technical Lead")).toBe(true);
  });

  it("rejects individual-contributor titles", () => {
    for (const title of ["Software Engineer", "Lead Engineer", "Senior Specialist", "Operations Officer", "Project Coordinator"]) {
      expect(isTightManagerialTitle(title), title).toBe(false);
    }
  });
});

describe("isRecent", () => {
  const now = Date.UTC(2026, 9, 1);

  it("keeps a recent posting", () => {
    expect(isRecent(new Date(now - 5 * DAY).toISOString(), now)).toBe(true);
  });

  it("drops a posting older than the window", () => {
    expect(isRecent(new Date(now - 60 * DAY).toISOString(), now)).toBe(false);
  });

  it("keeps a posting with no usable date", () => {
    expect(isRecent(null, now)).toBe(true);
    expect(isRecent("not a date", now)).toBe(true);
  });
});

describe("passesListCriteria", () => {
  const good = { title: "Senior Manager, Finance", location: "Abu Dhabi", postedAt: new Date().toISOString() };

  it("accepts a managerial, local, recent posting", () => {
    expect(passesListCriteria(good)).toBe(true);
  });

  it("rejects each rule on its own", () => {
    expect(passesListCriteria({ ...good, title: "Software Engineer" })).toBe(false);
    expect(passesListCriteria({ ...good, location: "Dubai" })).toBe(false);
    expect(passesListCriteria({ ...good, postedAt: new Date(Date.now() - 90 * DAY).toISOString() })).toBe(false);
  });

  it("judges a sitemap posting by the place at the start of its title", () => {
    const sitemap = { location: "", postedAt: null };
    expect(passesListCriteria({ ...sitemap, title: "Abu Dhabi Senior Manager Finance" }, { skipLocation: true })).toBe(true);
    expect(passesListCriteria({ ...sitemap, title: "Dubai Senior Manager Finance" }, { skipLocation: true })).toBe(false);
  });
});
