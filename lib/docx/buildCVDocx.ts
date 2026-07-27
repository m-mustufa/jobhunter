import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
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

const ACCENT = "1F3A5F";
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

function sectionHeading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: ACCENT, size: 21 })],
  });
}

export async function buildCVDocxBlob(doc: CVDocument): Promise<Blob> {
  const { profile, summary, skills, experience, education } = doc;
  const contactParts = [profile.email, profile.phone, ...profile.links].filter(Boolean);

  const nameBlock: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: profile.name || "Candidate", bold: true, size: 40 })],
    }),
  ];

  if (profile.title || profile.location) {
    nameBlock.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: [profile.title, profile.location].filter(Boolean).join(" — "), size: 22 }),
        ],
      })
    );
  }

  if (contactParts.length) {
    nameBlock.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: contactParts.join("  ·  "), size: 19, color: "555555" })],
      })
    );
  }

  const children: (Paragraph | Table)[] = [];

  if (profile.photo) {
    const { bytes, mime } = dataUrlToBytes(profile.photo);
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: NO_CELL_BORDERS,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 18, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                borders: NO_CELL_BORDERS,
                children: [
                  new Paragraph({
                    children: [
                      new ImageRun({
                        type: mime === "image/png" ? "png" : "jpg",
                        data: bytes,
                        transformation: { width: 72, height: 72 },
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 82, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                borders: NO_CELL_BORDERS,
                children: nameBlock,
              }),
            ],
          }),
        ],
      })
    );
  } else {
    children.push(...nameBlock);
  }

  if (summary) {
    children.push(sectionHeading("Professional Summary"));
    children.push(new Paragraph({ children: [new TextRun({ text: summary, size: 21 })] }));
  }

  if (skills.length) {
    children.push(sectionHeading("Core Skills"));
    children.push(new Paragraph({ children: [new TextRun({ text: skills.join("  ·  "), size: 21 })] }));
  }

  if (experience.length) {
    children.push(sectionHeading("Experience"));
    for (const entry of experience) {
      children.push(
        new Paragraph({
          spacing: { before: 160 },
          alignment: AlignmentType.LEFT,
          children: [
            new TextRun({ text: [entry.role, entry.company].filter(Boolean).join(" — "), bold: true, size: 22 }),
            ...(entry.dates ? [new TextRun({ text: `    ${entry.dates}`, size: 19, color: "555555" })] : []),
          ],
        })
      );
      for (const bullet of entry.bullets) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: bullet, size: 21 })],
          })
        );
      }
    }
  }

  if (education.length) {
    children.push(sectionHeading("Education"));
    for (const line of education) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 21 })] }));
    }
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}
