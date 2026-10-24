import { describe, expect, it, vi } from "vitest";

import { TailoringQualityError, toValidatedAnalysis } from "@/lib/analyzeJob";
import type { Profile } from "@/lib/types";

// The full reply check, end to end, on a small made-up CV and vacancy. Quality
// shortfalls (a near-copy, an uncovered top requirement, a long highlight) are
// kept; anything that could make the CV claim something untrue is sent back.

const profile: Profile = {
  name: "Sam Example",
  title: "Quality Manager",
  location: "Abu Dhabi",
  email: "sam@example.com",
  phone: "+971500000000",
  links: [],
  photo: "",
  cvFormat: "pdf",
  cvTemplate: "sidebar-v1",
  resumeFile: null,
  summary: "Quality professional with experience in inspections and audits.",
  skills: ["Quality assurance", "Auditing", "Stakeholder engagement", "Reporting"],
  experience: [
    {
      company: "Acme Industrial",
      role: "Quality Manager",
      dates: "2019 - PRESENT",
      bullets: [
        "Led a team of quality inspectors who carried out supplier audits across several manufacturing sites.",
        "Prepared monthly quality reports for senior management and tracked corrective actions until closure.",
        "Introduced a supplier scorecard that improved on-time delivery and reduced repeat defects.",
      ],
    },
    {
      company: "Globex Engineering",
      role: "Quality Engineer",
      dates: "2015 - 2019",
      bullets: [
        "Inspected contractor welding activities against approved procedures and recorded every non-conformance.",
        "Coordinated third-party inspection visits and reviewed material test certificates before release.",
        "Trained junior engineers on inspection methods and documentation standards.",
      ],
    },
  ],
  education: ["B.Sc. Mechanical Engineering"],
  certifications: [],
  languages: ["English (Fluent)"],
};

const job = {
  title: "Senior Quality Manager",
  company: "Example Energy",
  description:
    "Senior Quality Manager. Responsibilities: lead the quality team and supplier audits; report quality performance to senior management; drive corrective actions to closure; manage contractor inspections and third-party inspection; develop engineers through training; maintain quality documentation standards. Requirements: degree in engineering and strong analytical skills.",
};

const SOURCE = profile.experience.map((entry) => entry.bullets);

const SUMMARY =
  "Quality manager who leads inspection teams and supplier audits across several manufacturing sites. " +
  "Directs quality inspectors, reports monthly quality results to senior management, and follows corrective actions through to closure. " +
  "Created a supplier scorecard that improved on-time delivery and reduced repeat defects. " +
  "Earlier work as a quality engineer covered contractor welding inspections against approved procedures, with every non-conformance recorded. " +
  "Coordinated third-party inspection visits and reviewed material test certificates before release. " +
  "Coaches junior engineers on inspection methods and documentation standards. " +
  "Combines hands-on inspection experience with team leadership and clear reporting to senior management, supporting quality assurance, auditing, stakeholder engagement and reporting work. " +
  "Throughout, the focus has been on keeping inspection work consistent, recording non-conformance findings accurately, and making sure corrective actions are followed until they are closed. " +
  "Brings a practical approach to supplier audits and quality reporting.";

const COVER_LETTER =
  "I am writing to apply for the Senior Quality Manager role at Example Energy. In my current position I lead a team of quality inspectors, carry out supplier audits across several manufacturing sites and report monthly quality results to senior management.\n\n" +
  "Earlier, as a quality engineer, I inspected contractor welding activities against approved procedures, coordinated third-party inspection visits and trained junior engineers on inspection methods and documentation standards. I would welcome the chance to bring the same discipline to your quality function.";

function baseReply(): any {
  return {
    promptSchemaRevision: "cv-tailoring-v3.2",
    score: 72,
    verdict: "A solid fit for a senior quality role, with direct audit, reporting and inspection evidence.",
    reasons: [
      "Leads supplier audits and a quality team.",
      "Reports quality results to senior management.",
      "Has contractor and third-party inspection experience.",
    ],
    roleResearch: { normalizedRole: "Quality manager", marketContext: "", expectations: ["Supplier audits", "Quality reporting", "Inspections"], sources: [] },
    rankedRequirements: [
      { id: "R1", priority: 1, importance: "mandatory", requirement: "Lead the quality team and supplier audits", source: "job_description", evidence: [{ experienceIndex: 0, bulletIndices: [0] }] },
      { id: "R2", priority: 2, importance: "mandatory", requirement: "Report quality performance to senior management", source: "job_description", evidence: [{ experienceIndex: 0, bulletIndices: [1] }] },
      { id: "R3", priority: 3, importance: "mandatory", requirement: "Drive corrective actions to closure", source: "job_description", evidence: [{ experienceIndex: 0, bulletIndices: [1] }] },
      { id: "R4", priority: 4, importance: "preferred", requirement: "Manage contractor inspections and third-party inspection", source: "job_description", evidence: [{ experienceIndex: 1, bulletIndices: [0, 1] }] },
      { id: "R5", priority: 5, importance: "preferred", requirement: "Develop engineers through training", source: "job_description", evidence: [{ experienceIndex: 1, bulletIndices: [2] }] },
      { id: "R6", priority: 6, importance: "context", requirement: "Strong analytical skills", source: "job_description", evidence: [] },
    ],
    tailoredSummary: SUMMARY,
    skillsOrder: [0, 1, 3, 2],
    experienceRewriteVersion: 3,
    experienceRewrites: [
      {
        experienceIndex: 0,
        company: "Acme Industrial",
        supported: true,
        tailoredHighlights: [
          { text: "Directed quality inspectors during supplier audits spanning multiple manufacturing sites.", sourceBulletIndices: [0], requirementIds: ["R1"] },
          { text: "Reported quality results to senior management every month and followed corrective actions through to closure.", sourceBulletIndices: [1], requirementIds: ["R2", "R3"] },
          { text: "Created a supplier scorecard that lifted on-time delivery and cut repeat defects.", sourceBulletIndices: [2], requirementIds: [] },
        ],
        remainingBulletOrder: [],
      },
      {
        experienceIndex: 1,
        company: "Globex Engineering",
        supported: true,
        tailoredHighlights: [
          { text: "Checked contractor welding work against approved procedures and logged every non-conformance.", sourceBulletIndices: [0], requirementIds: ["R4"] },
          { text: "Arranged third-party inspection visits and checked material test certificates before release.", sourceBulletIndices: [1], requirementIds: ["R4"] },
          { text: "Coached junior engineers on inspection methods and documentation standards.", sourceBulletIndices: [2], requirementIds: ["R5"] },
        ],
        remainingBulletOrder: [],
      },
    ],
    coverLetter: COVER_LETTER,
    auditTrail: [],
  };
}

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
