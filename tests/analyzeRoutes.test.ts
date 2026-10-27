import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as buildPromptRoute } from "@/app/api/analyze/prompt/route";
import { POST as importRoute } from "@/app/api/analyze/import/route";
import { baseReply, job, profile } from "./fixtures/cv";

// The free "tailor via Claude Desktop" flow end to end at the HTTP layer:
// /api/analyze/prompt builds the text to paste into Claude, and
// /api/analyze/import checks the reply that comes back. Neither calls Claude.

const post = (route: (req: Request) => Promise<Response>, body: unknown) =>
  route(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

const jobBody = { ...job, location: "Abu Dhabi" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/analyze/prompt", () => {
  it("builds a prompt holding the vacancy and the candidate's own evidence", async () => {
    const res = await post(buildPromptRoute, { job: jobBody, profile });
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    expect(prompt).toContain("PROMPT_SCHEMA_REVISION");
    expect(prompt).toContain("Senior Quality Manager");
    expect(prompt).toContain("Example Energy");
    expect(prompt).toContain(profile.experience[0].bullets[0]);
    expect(prompt).toContain("[experienceIndex=1] COMPANY: Globex Engineering");
  });

  it("asks for one web search unless role research is switched off", async () => {
    const withResearch = await (await post(buildPromptRoute, { job: jobBody, profile })).json();
    expect(withResearch.prompt).toContain("web-search tool exactly ONCE");

    vi.stubEnv("ROLE_RESEARCH_ENABLED", "false");
    const without = await (await post(buildPromptRoute, { job: jobBody, profile })).json();
    expect(without.prompt).toContain("No external role research is supplied");
  });

  it.each([
    ["no job", { profile }],
    ["no profile", { job: jobBody }],
    ["a job with no title", { job: { ...jobBody, title: "  " }, profile }],
    ["a job with no description", { job: { ...jobBody, description: "" }, profile }],
    ["a description that is not text", { job: { ...jobBody, description: 42 }, profile }],
  ])("answers 400 for %s", async (_label, body) => {
    const res = await post(buildPromptRoute, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await post(buildPromptRoute, "{not json")).status).toBe(400);
  });
});

describe("POST /api/analyze/import", () => {
  const importReply = (reply: unknown, extra: Record<string, unknown> = {}) =>
    post(importRoute, {
      text: typeof reply === "string" ? reply : JSON.stringify(reply),
      profile,
      job: jobBody,
      ...extra,
    });

  it("turns a valid reply into the finished analysis", async () => {
    const res = await importReply(baseReply());
    expect(res.status).toBe(200);
    const analysis = await res.json();
    expect(analysis.tailoredCV.experience[0].bullets).toHaveLength(3);
    expect(analysis.tailoredCV.experience[0].bullets[0]).toContain("Directed quality inspectors");
    expect(analysis.coverLetter).toBeTruthy();
  });

  it("reads a reply wrapped in a markdown fence and surrounding words", async () => {
    const wrapped = `Here is the tailored CV:\n\`\`\`json\n${JSON.stringify(baseReply(), null, 2)}\n\`\`\`\nLet me know if anything needs changing.`;
    const res = await importReply(wrapped);
    expect(res.status).toBe(200);
  });

  it("sends a reply that could make the CV untrue back with a ready correction prompt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = baseReply();
    reply.experienceRewrites[1].tailoredHighlights[0].text =
      "Led contractor welding checks against approved procedures. Logged every non-conformance.";
    const res = await importReply(reply);
    expect(res.status).toBe(422);
    const body = await res.json();

    expect(body.error).toMatch(/needs 1 evidence correction/);
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]).toContain('"Led contractor welding checks against approved procedures."');

    // The correction prompt carries the failed reply so Claude fixes it rather than starting over.
    expect(body.correctionPrompt).toContain("CORRECTIVE PASS");
    expect(body.correctionPrompt).toContain(body.issues[0]);
    expect(body.correctionPrompt).toContain("PREVIOUS RESPONSE:");
    expect(body.correctionPrompt).toContain("Led contractor welding checks");
    // A correction pass does not ask for another web search.
    expect(body.correctionPrompt).toContain("No external role research is supplied");
  });

  it("shows only the first three problems in the message and counts the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reply = baseReply();
    // Four separate tool/standard claims the evidence never states.
    reply.experienceRewrites[0].tailoredHighlights[2].text =
      "Created a supplier scorecard using SAP, Oracle, Power BI and Tableau for on-time delivery.";
    reply.experienceRewrites[1].tailoredHighlights[2].text =
      "Coached junior engineers on inspection methods using Six Sigma and ISO 9001 documentation standards. Brings a certified approach.";
    reply.experienceRewrites[1].tailoredHighlights[0].text =
      "Led contractor welding checks against approved procedures. Logged every non-conformance.";
    const res = await importReply(reply);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issues.length).toBeGreaterThan(3);
    expect(body.error).toMatch(new RegExp(`Plus ${body.issues.length - 3} more`));
  });

  it("answers 400 and explains when the pasted text is not JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await importReply("Sorry, I could not do that.");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Couldn't read that|valid response/);
  });

  it.each([
    ["no pasted text", { text: "   " }],
    ["no profile", { profile: null }],
    ["no job", { job: null }],
    ["a job with no description", { job: { ...jobBody, description: " " } }],
  ])("answers 400 for %s", async (_label, override) => {
    const res = await importReply(baseReply(), override);
    expect(res.status).toBe(400);
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await post(importRoute, "{not json")).status).toBe(400);
  });
});
