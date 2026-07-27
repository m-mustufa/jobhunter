// Best-effort photo extraction from an uploaded resume file, so the user
// doesn't have to re-upload a photo that's already in their CV. Heuristic,
// not exhaustive: picks the largest embedded raster image, on the
// assumption a headshot is bigger than any logo/icon/watermark elsewhere
// in the document. The client re-compresses whatever this finds before
// storing it, so no size/format handling is needed here — just find it.

// PDFs most commonly embed photos via the DCTDecode filter, which stores
// the JPEG bytes verbatim inside the PDF. That means a full PDF parser
// isn't needed — just scan the raw file bytes for JPEG SOI/EOI markers.
export function extractLargestJpegFromPdf(buffer: Buffer): string | null {
  const SOI = Buffer.from([0xff, 0xd8]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let best: Buffer | null = null;
  let from = 0;
  while (true) {
    const start = buffer.indexOf(SOI, from);
    if (start === -1) break;
    const end = buffer.indexOf(EOI, start + 2);
    if (end === -1) break;
    const candidate = buffer.subarray(start, end + 2);
    if (!best || candidate.length > best.length) best = candidate;
    from = end + 2;
  }
  if (!best || best.length < 2000) return null; // too small to be a real headshot
  return `data:image/jpeg;base64,${best.toString("base64")}`;
}

// mammoth's default HTML conversion embeds images as inline base64 data
// URIs — pull the largest one out.
export function extractLargestImageFromHtml(html: string): string | null {
  const matches = [...html.matchAll(/src="(data:image\/[a-zA-Z+]+;base64,[^"]+)"/g)];
  if (!matches.length) return null;
  let best = matches[0][1];
  for (const m of matches) if (m[1].length > best.length) best = m[1];
  return best.length > 2000 ? best : null;
}
