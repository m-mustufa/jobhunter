import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { CVDocument } from "../cvDocument";

const ACCENT = "1F3A5F";

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

  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: profile.name || "Candidate", bold: true, size: 40 })],
    }),
  ];

  if (profile.title || profile.location) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: [profile.title, profile.location].filter(Boolean).join(" — "), size: 22 }),
        ],
      })
    );
  }

  if (contactParts.length) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: contactParts.join("  ·  "), size: 19, color: "555555" })],
      })
    );
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
