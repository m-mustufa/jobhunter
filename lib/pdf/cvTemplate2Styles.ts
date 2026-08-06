// Shared print-native CSS for CvHtmlTemplate2 ("Sidebar Blue") — a second,
// fully custom pixel-perfect design ported from a user-supplied reference
// (cv-template-2-semantic.css/html). Kept in the reference's native mm units
// (it targets @page{size:A4} directly) rather than converted to px like
// Template 1 — no reason to introduce rounding error across hundreds of
// precise values. Classes are prefixed cvtpl2- so this can never collide
// with cvtpl-/cltpl- (Template 1 / cover letter) if both ever render in the
// same document. The reference's own Glacial Indifference/Arimo/Nunito
// @font-face blocks are dropped entirely in favor of Lato everywhere, the
// only family with real font files in this project (public/fonts/Lato/).
//
// Deviates from the reference's own layout in one structural way: the
// reference was a fixed single 210x297mm page (position:absolute sidebar
// and content columns, overflow:hidden) with Education rendered as a second
// dated timeline in the main column. Real profiles (many skills, several
// certifications) overflowed that fixed page and got silently clipped, and
// Education — stored as flat undated strings, not a start/end range —
// left a large empty box in the reference's dated-timeline treatment. So
// this now flows naturally across as many printed pages as content needs
// (same grid + print-background trick as Template 1's cvTemplateStyles.ts),
// and Education/Certifications/Languages render as plain sidebar lists
// alongside Skills — matching Template 1's information architecture, kept
// in this template's own visual language (blue sidebar, portrait circle,
// icon-badge timeline for Experience).

export const CVTPL2_BLUE = "#174983";
export const CVTPL2_PAPER = "#efefef";
export const CVTPL2_INK = "#2e3440";
export const CVTPL2_WHITE = "#ffffff";

export const CV_TEMPLATE_2_CSS = `
@font-face { font-family: "Lato"; font-weight: 400; font-style: normal; src: local("Lato Regular"), local("Lato-Regular"), url("/fonts/Lato/Lato-Regular.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "Lato"; font-weight: 700; font-style: normal; src: local("Lato Bold"), local("Lato-Bold"), url("/fonts/Lato/Lato-Bold.ttf") format("truetype"); font-display: swap; }
@font-face { font-family: "Lato"; font-weight: 900; font-style: normal; src: local("Lato Black"), local("Lato-Black"), url("/fonts/Lato/Lato-Black.ttf") format("truetype"); font-display: swap; }

.cvtpl2-page {
  --cvtpl2-blue: ${CVTPL2_BLUE};
  --cvtpl2-paper: ${CVTPL2_PAPER};
  --cvtpl2-ink: ${CVTPL2_INK};
  --cvtpl2-white: ${CVTPL2_WHITE};
  --font-heading: "Lato", "Segoe UI", Arial, sans-serif;
  --font-body: "Lato", "Segoe UI", Arial, sans-serif;

  position: relative;
  display: grid;
  grid-template-columns: 69.5mm 1fr;
  align-items: stretch;
  width: 210mm;
  min-height: 297mm;
  background: var(--cvtpl2-paper);
  color: var(--cvtpl2-ink);
  font-family: var(--font-body);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.cvtpl2-page * { box-sizing: border-box; }

.cvtpl2-sidebar {
  position: relative;
  padding: 78.4mm 10.7mm 6mm;
  background: var(--cvtpl2-blue);
  color: var(--cvtpl2-white);
}

.cvtpl2-portrait-frame {
  position: absolute;
  top: 10.2mm;
  left: 9.3mm;
  width: 52.6mm;
  height: 52.6mm;
  margin: 0;
  border: 2.6mm solid #f2f2f2;
  border-radius: 50%;
  overflow: hidden;
  background: #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 18mm;
  color: var(--cvtpl2-white);
}
.cvtpl2-portrait-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 42%;
  display: block;
}

.cvtpl2-sidebar-section { margin: 0 0 5.8mm; break-inside: avoid; page-break-inside: avoid; }
.cvtpl2-sidebar-section:last-child { margin-bottom: 0; }
.cvtpl2-sidebar-heading {
  position: relative;
  margin: 0 0 5.1mm;
  font-family: var(--font-heading);
  font-size: 5.05mm;
  line-height: 1;
  font-weight: 700;
  letter-spacing: .75mm;
  color: #fff;
  break-after: avoid;
  page-break-after: avoid;
}
.cvtpl2-sidebar-heading::after {
  content: "";
  display: block;
  width: 12.1mm;
  height: .45mm;
  margin-top: 2.6mm;
  background: #fff;
}
.cvtpl2-profile-copy {
  margin: 0;
  font-size: 3.8mm;
  line-height: 1.4;
  text-justify: inter-word;
}
.cvtpl2-sidebar-list {
  margin: 0;
  padding-left: 5.3mm;
  font-size: 4.26mm;
  line-height: 1.8;
}
.cvtpl2-sidebar-list li { break-inside: avoid; page-break-inside: avoid; }
.cvtpl2-compact-list { line-height: 1.38; }

.cvtpl2-content {
  padding: 18.9mm 11.9mm 9mm 11.0mm;
}
.cvtpl2-identity-header h1 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 9.2mm;
  line-height: 1;
  font-weight: 700;
  letter-spacing: .35mm;
  color: var(--cvtpl2-blue);
}
.cvtpl2-role {
  margin: 1.1mm 0 7.6mm;
  font-size: 5.1mm;
  line-height: 1;
  letter-spacing: .35mm;
}
.cvtpl2-identity-rule {
  width: 100%;
  height: 1px;
  background: var(--cvtpl2-blue);
}
.cvtpl2-contact-row {
  display: flex;
  align-items: center;
  margin-top: 4.2mm;
  font-style: normal;
  font-size: 3.66mm;
  font-weight: bold;
  color: #394454;
}
.cvtpl2-contact-row span {
  padding: 0 4.6mm;
  text-align: center;
  border-left: .35mm solid var(--cvtpl2-blue);
  white-space: nowrap;
}
.cvtpl2-contact-row span:nth-child(1) { width: auto; padding-left: 0; text-align: left; border-left: 0; }
.cvtpl2-contact-row span:nth-child(2) { width: auto; }
.cvtpl2-contact-row span:nth-child(3) { width: auto; padding-right: 0; text-align: right; }

.cvtpl2-resume-body { margin-top: 23.4mm; }
.cvtpl2-timeline-section { position: relative; }
.cvtpl2-profile-section { break-inside: avoid; page-break-inside: avoid; }
.cvtpl2-profile-text { margin: 0; font-size: 4.3mm; line-height: 1.5; }
.cvtpl2-experience-section { margin-top: 8.7mm; }
.cvtpl2-section-title-row {
  display: flex;
  align-items: center;
  gap: 4mm;
  // margin-left: -5.2mm;
  break-after: avoid;
  page-break-after: avoid;
}
.cvtpl2-section-icon {
  display: grid;
  place-items: center;
  width: 10.2mm;
  height: 10.2mm;
  flex: 0 0 10.2mm;
  border-radius: 50%;
  background: var(--cvtpl2-blue);
  color: white;
  display: none;
}
.cvtpl2-section-icon svg { width: 6.4mm; height: 6.4mm; }
.cvtpl2-section-title-row h2 {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 5.2mm;
  line-height: 1;
  letter-spacing: .65mm;
  color: var(--cvtpl2-blue);
  font-weight: 800;
  border-bottom: 1px solid var(--cvtpl2-blue);
  padding-bottom: 5px;
  margin-bottom: 10px;
}
.cvtpl2-timeline-list {
  position: relative;
  margin-left: 0;
  padding: 6.3mm 0 3.4mm;
  border-left: .35mm solid var(--cvtpl2-blue);
  border-bottom: .35mm solid var(--cvtpl2-blue);
}
.cvtpl2-timeline-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  min-height: 28.8mm;
  margin-bottom: 3.8mm;
  break-inside: avoid;
  page-break-inside: avoid;
}
.cvtpl2-timeline-item:last-child { margin-bottom: 0; }
.cvtpl2-timeline-item::before {
  content: "";
  position: absolute;
  top: 15.5px;
  left: 0;
  width: 20.7mm;
  height: 1px;
  background: var(--cvtpl2-blue);
}
.cvtpl2-timeline-years {
  position: relative;
  z-index: 1;
  width: 27mm;
  flex: 0 0 27mm;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1.4mm;
  padding: 0 7.1mm 0 0;
  font-size: 3.35mm;
  line-height: 1;
  font-weight: 700;
  color: var(--cvtpl2-blue);
}
.cvtpl2-timeline-content {
  flex: 1 1 auto;
  min-width: 0;
  padding-right: .6mm;
  font-size: 3.18mm;
  line-height: 1.27;
}
.cvtpl2-timeline-content h3 {
  margin: -.3mm 0 .7mm;
  font-size: 4mm;
  line-height: 1.13;
  font-weight: 600;
}
.cvtpl2-timeline-content p { margin: 0 0 1.1mm; }
.cvtpl2-institution { font-size: 4mm; color: var(--cvtpl2-blue); }
.cvtpl2-timeline-content ul { margin: 1.0mm 0 0; padding-left: 0; }
.cvtpl2-timeline-content li { margin-bottom: .22mm; padding-left: 0;font-size: 3.5mm;line-height: 1.5; }

@media print {
  @page { size: 210mm 297mm; margin: 0; }
  html, body { background: #fff; margin: 0; }

  /* Fixed elements repeat on every printed page in Chromium — keeps the
     sidebar's blue running the full height of every page even past where
     its own content ends, matching Template 1's equivalent trick. */
  .cvtpl2-page::before {
    content: "";
    position: fixed;
    z-index: 0;
    top: 0;
    bottom: 0;
    left: 0;
    width: 69.5mm;
    background: var(--cvtpl2-blue);
  }
  .cvtpl2-sidebar, .cvtpl2-content { position: relative; z-index: 1; }
  .cvtpl2-sidebar { background: transparent; }
}
`;
