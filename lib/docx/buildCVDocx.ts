import {
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { CVDocument } from "../cvDocument";
import { dataUrlToBytes } from "../image";

// Best-effort DOCX match of the two-column PDF template (lib/pdf/CVPdf.tsx):
// navy header, gray sidebar with contact/skills/education, white main column
// with profile/experience. Word can't do the PDF's overlapping-photo effect
// or absolute positioning, so this approximates with nested borderless
// tables instead — same content and color story, not pixel-identical.
const NAVY = "323B4C";
const SIDEBAR_BG = "E4E4E4";
const TEXT_DARK = "000000";
const TEXT_BODY = "000000";
const TEXT_MUTED = "323B4C";
const DIVIDER = "163854";

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

function fullWidthTable(rows: TableRow[]) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: NO_CELL_BORDERS, rows });
}

function cell(children: Paragraph[], opts: { width: number; fill?: string; colSpan?: number }) {
  return new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    columnSpan: opts.colSpan,
    shading: opts.fill ? { fill: opts.fill } : undefined,
    verticalAlign: VerticalAlign.TOP,
    borders: NO_CELL_BORDERS,
    margins: { top: 160, bottom: 160, left: 160, right: 160 },
    children,
  });
}

function sideHeading(text: string) {
  return new Paragraph({
    spacing: { before: 140, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEXT_DARK, space: 3 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: TEXT_DARK, size: 21, font: "Aptos Display" })],
  });
}

function mainHeading(text: string) {
  return new Paragraph({
    spacing: { before: 160, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: DIVIDER, space: 4 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: TEXT_DARK, size: 22, font: "Aptos Display" })],
  });
}

function sideBullet(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 50 },
    children: [new TextRun({ text, size: 17, color: TEXT_BODY })],
  });
}

export async function buildCVDocxBlob(doc: CVDocument): Promise<Blob> {
  const { profile, summary, skills, experience, education } = doc;

  // --- Header: navy band with photo + name/title ---
  const nameParas: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: (profile.name || "Candidate").toUpperCase(), bold: true, color: "FFFFFF", size: 36, font: "Aptos Display" })],
    }),
  ];
  if (profile.title) {
    nameParas.push(
      new Paragraph({
        spacing: { before: 60 },
        children: [new TextRun({ text: profile.title.toUpperCase(), color: "FFFFFF", size: 22, font: "Aptos Display" })],
      })
    );
  }

  const headerInnerRows: TableRow[] = [];
  if (profile.photo) {
    const { bytes, mime } = dataUrlToBytes(profile.photo);
    headerInnerRows.push(
      new TableRow({
        children: [
          cell(
            [
              new Paragraph({
                children: [
                  new ImageRun({
                    type: mime === "image/png" ? "png" : "jpg",
                    data: bytes,
                    transformation: { width: 64, height: 64 },
                  }),
                ],
              }),
            ],
            { width: 18, fill: NAVY }
          ),
          cell(nameParas, { width: 82, fill: NAVY }),
        ],
      })
    );
  } else {
    headerInnerRows.push(new TableRow({ children: [cell(nameParas, { width: 100, fill: NAVY })] }));
  }

  // --- Sidebar: contact, skills, education ---
  const contactParas: Paragraph[] = [];
  if (profile.phone) contactParas.push(sideBullet(profile.phone));
  if (profile.email) contactParas.push(sideBullet(profile.email));
  if (profile.location) contactParas.push(sideBullet(profile.location));
  for (const link of profile.links) contactParas.push(sideBullet(link));

  const sidebarChildren: Paragraph[] = [sideHeading("Contact"), ...contactParas];
  if (skills.length) {
    sidebarChildren.push(sideHeading("Skills"), ...skills.map((s) => sideBullet(s)));
  }
  if (education.length) {
    sidebarChildren.push(sideHeading("Education"), ...education.map((line) => sideBullet(line)));
  }

  // --- Main: profile, work experience ---
  const mainChildren: Paragraph[] = [];
  if (summary) {
    mainChildren.push(mainHeading("Profile"));
    mainChildren.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: summary, size: 19, color: TEXT_BODY })] }));
  }
  if (experience.length) {
    mainChildren.push(mainHeading("Work Experience"));
    for (const entry of experience) {
      if (entry.company) {
        mainChildren.push(
          new Paragraph({
            spacing: { before: 120 },
            children: [
              new TextRun({ text: entry.company, bold: true, color: TEXT_DARK, size: 20 }),
              ...(entry.dates ? [new TextRun({ text: `    ${entry.dates.toUpperCase()}`, size: 16, color: TEXT_MUTED })] : []),
            ],
          })
        );
      }
      if (entry.role) {
        mainChildren.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: entry.role, color: TEXT_MUTED, size: 18 })],
          })
        );
      }
      for (const b of entry.bullets) {
        mainChildren.push(
          new Paragraph({ bullet: { level: 0 }, spacing: { after: 50 }, children: [new TextRun({ text: b, size: 19, color: TEXT_BODY })] })
        );
      }
    }
  }

  const document = new Document({
    sections: [
      {
        children: [
          fullWidthTable(headerInnerRows),
          fullWidthTable([
            new TableRow({
              children: [cell(sidebarChildren, { width: 31, fill: SIDEBAR_BG }), cell(mainChildren, { width: 69 })],
            }),
          ]),
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}
