// Shared print-native CSS for CvHtmlTemplate and CoverLetterHtmlTemplate.
// Used two ways: embedded via <style> in the live in-app preview, and
// embedded in the standalone print window (lib/print/printHtml.ts) — same
// string either way, so the two can never drift apart. Class names are
// prefixed (cvtpl-/cltpl-) to stay isolated from the app's own Tailwind
// classes when rendered inline in the app.

export const INK = "#323b4c";
export const SIDEBAR_BG = "#e4e4e4";
export const PAPER = "#fdfdfd";
export const RULE = "#163854";

// Now and Aileron were dropped in favor of Lato everywhere — Lato is the
// only family with real font files (public/fonts/Lato/), so using it for
// headings/meta text too means every size in this template renders in its
// real font instead of two of three families silently falling back to
// Arial/Segoe UI. Lato-Black.ttf covers the 900-weight used for the name.
export const CV_TEMPLATE_CSS = `
@font-face { font-family: "Lato"; font-weight: 400; font-style: normal; src: local("Lato Regular"), local("Lato-Regular"), url("/fonts/Lato/Lato-Regular.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "Lato"; font-weight: 700; font-style: normal; src: local("Lato Bold"), local("Lato-Bold"), url("/fonts/Lato/Lato-Bold.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "Lato"; font-weight: 900; font-style: normal; src: local("Lato Black"), local("Lato-Black"), url("/fonts/Lato/Lato-Black.ttf") format("truetype"); font-display: swap; }

.cvtpl-root, .cltpl-root {
  --ink: ${INK};
  --sidebar-bg: ${SIDEBAR_BG};
  --paper: ${PAPER};
  --rule: ${RULE};
  --font-heading: "Lato", "Segoe UI", Arial, sans-serif;
  --font-body: "Lato", "Segoe UI", Arial, sans-serif;
  --font-meta: "Lato", "Segoe UI", Arial, sans-serif;

  position: relative;
  width: 794px;
  margin: 0 auto;
  background: var(--paper);
  color: #000;
  font-family: var(--font-body);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}

.cvtpl-root * , .cltpl-root * { box-sizing: border-box; }

/* ---- header + photo (page 1 only, by construction — single flow) ---- */

.cvtpl-header {
  background: var(--ink);
  padding: 63px 40px 51px 314px;
}
.cvtpl-name {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 900;
  font-size: 29.4px;
  line-height: 1.05;
  letter-spacing: 2px;
  color: var(--paper);
}
.cvtpl-title {
  margin: 10px 0 0;
  font-family: var(--font-heading);
  font-weight: 400;
  font-size: 19.2px;
  letter-spacing: 2px;
  color: var(--paper);
}
.cvtpl-photo {
  position: absolute;
  left: 28px;
  top: 78px;
  width: 188px;
  height: 188px;
  border-radius: 50%;
  border: 5px solid var(--paper);
  background: #c9cdd2;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 52px;
  color: var(--paper);
}
.cvtpl-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* ---- two-column grid: sidebar stretches to match main column height,
   including on pages where the sidebar itself has run out of content ---- */

.cvtpl-grid { display: grid; grid-template-columns: 245px 1fr; align-items: stretch; }

.cvtpl-sidebar { background: var(--sidebar-bg); padding: 122px 27px 40px; }
.cvtpl-sidebar-section { margin-bottom: 40px; }
.cvtpl-sidebar-section:last-child { margin-bottom: 0; }
.cvtpl-sidebar-heading {
  margin: 0 0 9px;
  font-family: var(--font-heading);
  font-weight: 900;
  font-size: 20px;
  line-height: 1.15;
  letter-spacing: 2px;
  color: #000;
  text-transform: uppercase;
  break-after: avoid;
  page-break-after: avoid;
}
.cvtpl-sidebar-heading::after {
  content: ""; display: block; margin-top: 9px; width: 190px; max-width: 100%; height: 1.2px; background: var(--ink);
}
.cvtpl-contact-list, .cvtpl-bullet-list {
  list-style: none; margin: 16px 0 0; padding: 0;
  font-family: var(--font-body); font-size: 13.3px; color: var(--ink);
}
.cvtpl-contact-list li { display: flex; align-items: flex-start; gap: 11px; line-height: 1.3; margin-bottom: 19px; }
.cvtpl-contact-list li:last-child { margin-bottom: 0; }
.cvtpl-contact-list .icon { flex: 0 0 14px; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }
.cvtpl-bullet-list li {
  position: relative;
  padding-left: 14px;
  line-height: 1.5;
  margin-bottom: 9px;
  break-inside: avoid;
  page-break-inside: avoid;
}
.cvtpl-bullet-list li:last-child { margin-bottom: 0; }
.cvtpl-bullet-list li::before {
  content: ""; position: absolute; left: 0; top: 7px; width: 4px; height: 4px; border-radius: 50%; background: var(--ink);
}

.cvtpl-main { padding: 57px 40px 55px 69px; font-family: var(--font-body); }

.cvtpl-timeline { position: relative; margin-left: -37px; padding-left: 30px; border-left: 1px solid var(--ink); }

.cvtpl-heading { position: relative; margin: 0 0 18px -37px; padding-left: 37px; break-after: avoid; }
.cvtpl-heading .icon-badge {
  position: absolute; left: -7px; top: -3px; width: 27px; height: 27px; border-radius: 50%;
  background: var(--ink); display: flex; align-items: center; justify-content: center; z-index: 2;
}
.cvtpl-heading .heading-text {
  display: block; padding-bottom: 7px; border-bottom: 1.6px solid var(--rule);
  font-family: var(--font-heading); font-weight: 900; font-size: 20px; letter-spacing: 2px; line-height: 1; color: #000; text-transform: uppercase;
}

.cvtpl-content-section { margin-bottom: 30px; }
.cvtpl-content-section:last-child { margin-bottom: 0; }
.cvtpl-profile-text { margin: 0; font-size: 16px; line-height: 1.34; }

.cvtpl-entry { position: relative; break-inside: auto; page-break-inside: auto; }
.cvtpl-entry + .cvtpl-entry { margin-top: 29px; }
.cvtpl-entry-lead { break-inside: avoid; page-break-inside: avoid; }
.cvtpl-entry-header { display: flex; justify-content: space-between; align-items: baseline; gap: 18px; }
.cvtpl-entry-company { margin: 0; font-family: var(--font-meta); font-weight: 800; font-size: 14.7px; line-height: 1.25; color: var(--ink); }
.cvtpl-entry-role { margin: 2px 0 0; font-family: var(--font-meta); font-weight: 400; font-size: 14.7px; line-height: 1.3; color: var(--ink); }
.cvtpl-entry-dates { flex-shrink: 0; margin: 0; font-family: var(--font-meta); font-weight: 400; font-size: 13.3px; color: var(--ink); white-space: nowrap; text-transform: uppercase; }

.cvtpl-bullets { list-style: none; margin: 24px 0 0; padding: 0; font-size: 16px; line-height: 1.34; }
.cvtpl-bullets--continued { margin-top: 0; }
.cvtpl-bullets li {
  position: relative;
  margin: 0;
  break-inside: avoid;
  page-break-inside: avoid;
}
.cvtpl-bullets li::before {
  content: ""; position: absolute; box-sizing: border-box; left: -34.5px; margin-left: 0; top: 8px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--paper); border: 2px solid var(--ink);
}

/* ---- cover letter (separate, simple design in the same visual language) ---- */

.cltpl-root { padding: 64px 64px 72px; }
.cltpl-name { margin: 0; font-family: var(--font-heading); font-weight: 900; font-size: 24px; color: var(--ink); }
.cltpl-contact { margin: 6px 0 0; font-family: var(--font-body); font-size: 12px; color: var(--ink); }
.cltpl-rule { height: 2px; background: var(--ink); margin: 20px 0 32px; border: none; }
.cltpl-date { margin: 0 0 24px; font-family: var(--font-body); font-size: 13px; color: var(--ink); }
.cltpl-recipient { margin: 0 0 20px; font-family: var(--font-body); font-size: 13px; color: var(--ink); }
.cltpl-re { margin: 0 0 16px; font-family: var(--font-meta); font-weight: 700; font-size: 13.5px; color: var(--ink); }
.cltpl-greeting { margin: 0 0 14px; font-family: var(--font-body); font-size: 14px; }
.cltpl-paragraph { margin: 0 0 14px; font-family: var(--font-body); font-size: 14px; line-height: 1.6; }
.cltpl-signoff { margin: 24px 0 0; font-family: var(--font-body); font-size: 14px; }

/* ---- print ---- */

@media print {
  @page { size: 210mm 297mm; margin: 0; }
  html, body { background: #fff; margin: 0; }
  .cvtpl-root, .cltpl-root { width: 210mm; }

  /* Fixed elements are repeated by Chromium on every printed page. This
     keeps the sidebar colour running to the bottom even after its content
     has finished, while the real sidebar remains the content column. */
  .cvtpl-root::before {
    content: "";
    position: fixed;
    z-index: 0;
    top: 0;
    bottom: 0;
    left: 0;
    width: 245px;
    background: var(--sidebar-bg);
  }
  .cvtpl-header, .cvtpl-grid { position: relative; z-index: 1; }
  .cvtpl-sidebar { background: transparent; }

  /* The wrapper fragments with the right column and clones its 30px top
     padding on every new page. 27px + 30px keeps page 1 at its original
     57px position; the sidebar remains completely unaffected. */
  .cvtpl-main { padding-top: 27px; }
  .cvtpl-page-gutter {
    padding-top: 30px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  /* Keep the first page focused on contact and skills. Education and the
     sidebar sections after it always begin on the second printed page. */
  .cvtpl-education-section {
    break-before: page;
    page-break-before: always;
    break-inside: avoid;
    page-break-inside: avoid;
    padding-top: 40px;
  }
}
`;
