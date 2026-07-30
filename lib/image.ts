// Client-only helpers for turning an uploaded/extracted photo into a
// compact JPEG data URL — used so both a manually uploaded profile photo
// and one auto-extracted from a CV end up the same reasonable size before
// they're stored in localStorage or embedded in a generated CV.

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

// Center-crops to a square and downscales to `maxDim`, re-encoded as JPEG.
// Cropping to square (not just downscaling) matters here specifically
// because the CV templates place this photo in a fixed circular/square
// frame with no object-fit — a non-square source would otherwise be
// stretched to fit instead of cropped.
export function resizeImageDataUrl(dataUrl: string, maxDim = 480, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const out = Math.min(maxDim, side);
      const canvas = document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported."));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Could not load that image."));
    img.src = dataUrl;
  });
}

// Decodes a data URL into raw bytes + MIME type — docx's ImageRun needs
// raw bytes, not a data URL string.
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return { bytes: new Uint8Array(), mime: "image/jpeg" };
  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}
