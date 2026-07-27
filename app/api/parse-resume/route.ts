import { NextResponse } from "next/server";
import { extractStructuredResume } from "@/lib/parseResume";
import { extractLargestJpegFromPdf, extractLargestImageFromHtml } from "@/lib/extractImage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is too large (5MB max)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  let rawText: string;
  let photo: string | null = null;
  try {
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      // Import the underlying implementation directly, not the package's
      // top-level index.js — that file has a leftover debug self-test
      // (`if (!module.parent) { ...reads a hardcoded test fixture... }`)
      // that misfires under Next.js's bundler and throws ENOENT.
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      rawText = (await pdfParse(buffer)).text;
      try {
        photo = extractLargestJpegFromPdf(buffer);
      } catch {
        photo = null; // photo extraction is best-effort, never fatal
      }
    } else if (
      name.endsWith(".docx") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = await import("mammoth");
      rawText = (await mammoth.extractRawText({ buffer })).value;
      try {
        const html = (await mammoth.convertToHtml({ buffer })).value;
        photo = extractLargestImageFromHtml(html);
      } catch {
        photo = null;
      }
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a .pdf or .docx resume." },
        { status: 400 }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: `Could not read that file (${err.message}).` },
      { status: 400 }
    );
  }

  if (!rawText.trim()) {
    return NextResponse.json({ error: "No text could be extracted from that file." }, { status: 400 });
  }

  const result = await extractStructuredResume(rawText);
  if (photo) {
    result.profile = { ...result.profile, photo };
  }
  return NextResponse.json(result);
}
