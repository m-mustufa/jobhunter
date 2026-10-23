import { describe, expect, it } from "vitest";

import { uncoveredRequirementsIssue } from "@/lib/analyzeJob";

const experience = [
  { company: "Acme", role: "Manager", dates: "2018 - 2022", bullets: ["a", "b", "c"] },
  { company: "Globex", role: "Lead", dates: "2014 - 2018", bullets: ["d", "e"] },
];

const requirement = (id: string, text: string, evidence: { experienceIndex: number; bulletIndices: number[] }[]) =>
  ({ id, priority: 1, importance: "mandatory", requirement: text, source: "job_description", evidence }) as const;

describe("uncoveredRequirementsIssue", () => {
  it("names the requirement by its text and says where the evidence is", () => {
    const issue = uncoveredRequirementsIssue(
      [requirement("R5", "Manage contractor quality inspections", [{ experienceIndex: 1, bulletIndices: [0, 1] }])],
      experience
    );
    expect(issue).toContain('R5 "Manage contractor quality inspections"');
    expect(issue).toContain("Globex (experienceIndex 1, bullet 0/1)");
    expect(issue).toContain("top supported requirement:");
  });

  it("lists several requirements and uses the plural", () => {
    const issue = uncoveredRequirementsIssue(
      [
        requirement("R1", "Lead a team", [{ experienceIndex: 0, bulletIndices: [2] }]),
        requirement("R3", "Own the budget", [{ experienceIndex: 0, bulletIndices: [0] }]),
      ],
      experience
    );
    expect(issue).toContain("top supported requirements:");
    expect(issue).toContain('R1 "Lead a team"');
    expect(issue).toContain('R3 "Own the budget"');
  });

  it("tells the model how to fix it without allowing invented evidence", () => {
    const issue = uncoveredRequirementsIssue(
      [requirement("R2", "Report to the board", [{ experienceIndex: 0, bulletIndices: [1] }])],
      experience
    );
    expect(issue).toContain("match by the requirement text");
    expect(issue).toContain("requirementIds");
    expect(issue).toContain("only terms that appear in the source bullet");
    expect(issue).toContain("empty evidence list");
  });
});
