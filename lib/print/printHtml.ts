import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Renders a React element (a CvHtmlTemplate/CoverLetterHtmlTemplate) to a
// static HTML string and opens it in a new window for the browser's native
// print dialog — "Save as PDF" there gives a pixel-faithful result straight
// from the real HTML/CSS, no html2canvas/jsPDF/react-pdf involved. The
// window closes itself once the print dialog is dismissed (afterprint),
// with a fallback timer in case a browser doesn't fire that event.
export function printReactDocument(element: ReactElement, documentTitle: string): boolean {
  const markup = renderToStaticMarkup(element);
  // No "noopener" here — we need a live handle back into this popup's
  // document to write the markup into it, wait for fonts, print, and close
  // it; noopener severs exactly that connection.
  const popup = window.open("", "_blank", "width=900,height=1000");
  if (!popup) return false;

  popup.document.open();
  popup.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(documentTitle)}</title></head><body style="margin:0">${markup}</body></html>`
  );
  popup.document.close();

  // Wait for @font-face fonts to finish loading so print doesn't briefly
  // use fallback fonts — guarded so it only ever fires once even though
  // both the fonts promise and the safety-net timer can call it.
  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    popup.focus();
    popup.print();
  };
  const fonts = (popup.document as unknown as { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready && typeof fonts.ready.then === "function") {
    fonts.ready.then(triggerPrint).catch(triggerPrint);
  }
  setTimeout(triggerPrint, 1500);

  // Safari doesn't reliably fire afterprint for print-to-PDF — fall back to
  // closing a bit after the print dialog would have opened.
  let closed = false;
  const closeOnce = () => {
    if (closed) return;
    closed = true;
    popup.close();
  };
  popup.addEventListener("afterprint", closeOnce);
  setTimeout(closeOnce, 60_000);

  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
