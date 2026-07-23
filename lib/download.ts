export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously races the browser's async read of the blob for
  // the download, which can corrupt or duplicate the file. Defer it.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Browsers throttle/flag rapid consecutive auto-downloads triggered from a
// single click. Stagger multi-file downloads so each one actually lands.
export async function downloadBlobsStaggered(files: { blob: Blob; filename: string }[]) {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400));
    downloadBlob(files[i].blob, files[i].filename);
  }
}

export function safeFileSlug(text: string) {
  return text
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "document";
}
