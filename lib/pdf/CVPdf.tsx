import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { CVDocument } from "../cvDocument";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10.5, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.4 },
  name: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  titleLine: { fontSize: 11, color: "#333333", marginBottom: 3 },
  contactLine: { fontSize: 9.5, color: "#555555" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#cccccc", marginTop: 10, marginBottom: 12 },
  sectionTitle: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#1f3a5f",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 14,
  },
  paragraph: { fontSize: 10.5, marginBottom: 4 },
  skillsRow: { flexDirection: "row", flexWrap: "wrap" },
  skillChip: {
    fontSize: 9.5,
    backgroundColor: "#f0f3f8",
    color: "#1f3a5f",
    paddingVertical: 3,
    paddingHorizontal: 7,
    marginRight: 6,
    marginBottom: 6,
    borderRadius: 3,
  },
  roleBlock: { marginBottom: 10 },
  roleHeaderRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  roleTitle: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  roleDates: { fontSize: 9.5, color: "#555555" },
  bulletRow: { flexDirection: "row", marginBottom: 2, paddingLeft: 2 },
  bulletDot: { width: 10, fontSize: 10.5 },
  bulletText: { flex: 1, fontSize: 10.5 },
  eduLine: { fontSize: 10.5, marginBottom: 3 },
});

export function CVPdf({ doc }: { doc: CVDocument }) {
  const { profile, summary, skills, experience, education } = doc;
  const contactParts = [profile.email, profile.phone, ...profile.links].filter(Boolean);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{profile.name || "Candidate"}</Text>
        {(profile.title || profile.location) && (
          <Text style={styles.titleLine}>
            {[profile.title, profile.location].filter(Boolean).join(" — ")}
          </Text>
        )}
        {contactParts.length > 0 && <Text style={styles.contactLine}>{contactParts.join("  ·  ")}</Text>}
        <View style={styles.divider} />

        {summary && (
          <View>
            <Text style={styles.sectionTitle}>Professional Summary</Text>
            <Text style={styles.paragraph}>{summary}</Text>
          </View>
        )}

        {skills.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Core Skills</Text>
            <View style={styles.skillsRow}>
              {skills.map((s, i) => (
                <Text key={i} style={styles.skillChip}>
                  {s}
                </Text>
              ))}
            </View>
          </View>
        )}

        {experience.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Experience</Text>
            {experience.map((entry, i) => (
              <View key={i} style={styles.roleBlock} wrap={false}>
                <View style={styles.roleHeaderRow}>
                  <Text style={styles.roleTitle}>
                    {[entry.role, entry.company].filter(Boolean).join(" — ")}
                  </Text>
                  {entry.dates && <Text style={styles.roleDates}>{entry.dates}</Text>}
                </View>
                {entry.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {education.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Education</Text>
            {education.map((line, i) => (
              <Text key={i} style={styles.eduLine}>
                {line}
              </Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
