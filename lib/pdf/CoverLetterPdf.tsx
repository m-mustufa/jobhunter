import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { CoverLetterDocument } from "../cvDocument";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.5 },
  name: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  contactLine: { fontSize: 9.5, color: "#555555", marginBottom: 20 },
  date: { fontSize: 10.5, marginBottom: 16, color: "#333333" },
  recipient: { fontSize: 10.5, marginBottom: 16, color: "#333333" },
  paragraph: { fontSize: 11, marginBottom: 12 },
  signOff: { fontSize: 11, marginTop: 8 },
});

export function CoverLetterPdf({ doc }: { doc: CoverLetterDocument }) {
  const { profile, job, body, date } = doc;
  const contactParts = [profile.email, profile.phone, ...profile.links].filter(Boolean);
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{profile.name || "Candidate"}</Text>
        {contactParts.length > 0 && <Text style={styles.contactLine}>{contactParts.join("  ·  ")}</Text>}

        <Text style={styles.date}>{date}</Text>
        <Text style={styles.recipient}>
          {job.company} Hiring Team{job.location ? `\n${job.location}` : ""}
        </Text>

        <Text style={styles.paragraph}>Re: Application for {job.title}</Text>
        <Text style={styles.paragraph}>Dear Hiring Team,</Text>

        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>
            {p}
          </Text>
        ))}

        <Text style={styles.signOff}>Best regards,{"\n"}{profile.name || "Candidate"}</Text>
      </Page>
    </Document>
  );
}
