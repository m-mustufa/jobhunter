import { BatchItem, Job, Profile } from "./types";
import { CVDocument, buildCVDocument, buildCoverLetterDocument } from "./cvDocument";
import { getCvTemplateComponent } from "./pdf/cvTemplates";
import { CoverLetterHtmlTemplate } from "./pdf/CoverLetterHtmlTemplate";
import { printReactDocument } from "./print/printHtml";
import { downloadBlobsStaggered, safeFileSlug } from "./download";

// Shared CV/cover-letter generation, used by both the search page's Apply
// modal and the Applied Jobs page's re-download buttons — kept as pure
// functions (profile + item in, side effect of triggering downloads out) so
// neither caller duplicates the print/docx logic; each caller owns its own
// busy/error UI state around the call.

export function fileSlug(profile: Profile, job: Job): string {
  return `${safeFileSlug(profile.name || "candidate")}-${safeFileSlug(job.title)}`;
}

// Thrown instead of a generic Error so callers can show the specific
// pop-up-blocked message without string-matching.
export class PopupBlockedError extends Error {
  constructor() {
    super("Your browser blocked the print window — allow pop-ups for this site and try again.");
    this.name = "PopupBlockedError";
  }
}

// Shared by downloadCV and downloadSampleCV: respects the user's preferred
// download format (Profile → CV Format) and template (Profile → CV
// Template) — "both" prints (PDF, via the browser's native print-to-PDF)
// and downloads a .docx, "pdf"/"docx" only does its one.
async function generateCVFiles(profile: Profile, doc: CVDocument, filenameBase: string): Promise<void> {
  const format = profile.cvFormat;
  const Template = getCvTemplateComponent(profile.cvTemplate);

  if (format !== "docx") {
    if (!printReactDocument(<Template doc={doc} />, `${filenameBase}-CV`)) {
      throw new PopupBlockedError();
    }
  }
  if (format !== "pdf") {
    const { buildCVDocxBlob } = await import("./docx/buildCVDocx");
    await downloadBlobsStaggered([{ blob: await buildCVDocxBlob(doc), filename: `${filenameBase}-CV.docx` }]);
  }
}

export async function downloadCV(profile: Profile, item: BatchItem): Promise<void> {
  if (!item.analysis) return;
  const doc = buildCVDocument(profile, item.analysis.tailoredCV);
  await generateCVFiles(profile, doc, fileSlug(profile, item.job));
}

// Lets the user preview/download the selected CV template with their own
// Profile content directly (Summary/Skills/Experience/Education as entered,
// untailored) — no job search or AI tailoring needed first.
export async function downloadSampleCV(profile: Profile): Promise<void> {
  const doc = buildCVDocument(profile, {
    summary: profile.summary,
    skills: profile.skills,
    experience: profile.experience,
    education: profile.education,
  });
  await generateCVFiles(profile, doc, `${safeFileSlug(profile.name || "candidate")}-Sample`);
}

export async function downloadCoverLetter(profile: Profile, item: BatchItem): Promise<void> {
  if (!item.analysis) return;
  const format = profile.cvFormat;
  const doc = buildCoverLetterDocument(profile, item.job, item.analysis.coverLetter);
  const slug = fileSlug(profile, item.job);

  if (format !== "docx") {
    if (!printReactDocument(<CoverLetterHtmlTemplate doc={doc} />, `${slug}-CoverLetter`)) {
      throw new PopupBlockedError();
    }
  }
  if (format !== "pdf") {
    const { buildCoverLetterDocxBlob } = await import("./docx/buildCoverLetterDocx");
    await downloadBlobsStaggered([{ blob: await buildCoverLetterDocxBlob(doc), filename: `${slug}-CoverLetter.docx` }]);
  }
}
