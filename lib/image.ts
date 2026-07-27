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

// Downscales to at most `maxDim` on the longest side and re-encodes as
// JPEG, regardless of the source format or resolution.
export function resizeImageDataUrl(dataUrl: string, maxDim = 480, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported."));
      ctx.drawImage(img, 0, 0, w, h);
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
