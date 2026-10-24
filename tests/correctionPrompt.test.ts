import { describe, expect, it } from "vitest";

import { buildPrompt } from "@/lib/analyzeJob";
import { POST as importReply } from "@/app/api/analyze/import/route";
import { baseReply, job, profile } from "./fixtures/cv";

const issues = ["Acme Industrial highlight 3 adds unsupported numeric evidence (40%) in: \"x\" — delete this whole sentence."];

describe("corrective prompt", () => {
  it("carries the previous reply and asks for a fix of it, not a rebuild", () => {
    const previous = JSON.stringify(baseReply(), null, 1);
    const prompt = buildPrompt(job as any, profile, { correctionIssues: issues, previousResponse: previous });
    expect(prompt).toContain("CORRECTIVE PASS: Your previous response");
    expect(prompt).toContain("1. Acme Industrial highlight 3 adds unsupported numeric evidence");
    expect(prompt).toContain("Do not start over");
    expect(prompt).toContain("Do not weaken any evidence rule");
    expect(prompt).toContain("PREVIOUS RESPONSE:");
    expect(prompt).toContain("Directed quality inspectors during supplier audits");
  });

  it("falls back to the list of problems alone without a previous reply", () => {
    const prompt = buildPrompt(job as any, profile, { correctionIssues: issues });
    expect(prompt).toContain("The previous response failed these checks");
    expect(prompt).not.toContain("PREVIOUS RESPONSE:");
  });

  it("falls back too when the previous reply is too large to paste", () => {
    const prompt = buildPrompt(job as any, profile, { correctionIssues: issues, previousResponse: "x".repeat(50_000) });
    expect(prompt).toContain("The previous response failed these checks");
    expect(prompt).not.toContain("PREVIOUS RESPONSE:");
  });

  it("adds nothing when there is nothing to correct", () => {
    const prompt = buildPrompt(job as any, profile, { previousResponse: "{}" });
    expect(prompt).not.toContain("CORRECTIVE PASS");
    expect(prompt).not.toContain("PREVIOUS RESPONSE:");
  });
});

describe("POST /api/analyze/import", () => {
  const post = (text: string) =>
    importReply(
      new Request("http://localhost/api/analyze/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          profile,
          job: { title: job.title, company: job.company, location: "Abu Dhabi", description: job.description },
        }),
      })
    );

  it("imports a good reply, even one wrapped in a code fence", async () => {
    const response = await post("```json\n" + JSON.stringify(baseReply()) + "\n```");
    expect(response.status).toBe(200);
    const analysis = await response.json();
    expect(analysis.tailoredCV.experience[0].bullets[0]).toContain("Directed quality inspectors");
  });

  it("answers a failed check with a corrective prompt that includes that reply", async () => {
    const bad = baseReply();
    bad.experienceRewrites[0].tailoredHighlights[2].text =
      "Created a supplier scorecard that lifted on-time delivery by 40% and cut repeat defects.";
    const response = await post(JSON.stringify(bad));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.issues.join(" ")).toMatch(/unsupported numeric evidence/);
    expect(body.correctionPrompt).toContain("CORRECTIVE PASS: Your previous response");
    expect(body.correctionPrompt).toContain("PREVIOUS RESPONSE:");
    // The reply that failed is there, so the fix is a small edit of it.
    expect(body.correctionPrompt).toContain("lifted on-time delivery by 40%");
    // A correction never asks the model to search the web again.
    expect(body.correctionPrompt).not.toContain("Use the web-search tool");
  });

  it("explains what to fix in the error text", async () => {
    const bad = baseReply();
    bad.skillsOrder = [0, 1, 2];
    const response = await post(JSON.stringify(bad));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/needs 1 evidence correction/);
  });

  it("rejects text that is not a reply at all, without a correction prompt", async () => {
    const response = await post("Sorry, I cannot help with that.");
    expect(response.status).toBe(400);
    expect((await response.json()).correctionPrompt).toBeUndefined();
  });
});
