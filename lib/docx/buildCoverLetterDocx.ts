import { Document, Packer, Paragraph, TextRun } from "docx";
import { CoverLetterDocument } from "../cvDocument";

export async function buildCoverLetterDocxBlob(doc: CoverLetterDocument): Promise<Blob> {
  const { profile, job, body, date } = doc;
  const contactParts = [profile.email, profile.phone, ...profile.links].filter(Boolean);
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: profile.name || "Candidate", bold: true, size: 28 })] }),
  ];

  if (contactParts.length) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: contactParts.join("  ·  "), size: 19, color: "555555" })],
      })
    );
  }

  children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: date, size: 21 })] }));
  children.push(
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({ text: `${job.company} Hiring Team`, size: 21 }),
        ...(job.location ? [new TextRun({ text: job.location, size: 21, break: 1 })] : []),
      ],
    })
  );

  children.push(
    new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: `Re: Application for ${job.title}`, size: 21 })],
    })
  );
  children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: "Dear Hiring Team,", size: 21 })] }));

  for (const p of paragraphs) {
    children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: p, size: 21 })] }));
  }

  children.push(
    new Paragraph({
      spacing: { before: 120 },
      children: [
        new TextRun({ text: "Best regards,", size: 21 }),
        new TextRun({ text: profile.name || "Candidate", size: 21, break: 1 }),
      ],
    })
  );

  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}
