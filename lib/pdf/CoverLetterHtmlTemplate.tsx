import { CoverLetterDocument } from "../cvDocument";
import { CV_TEMPLATE_CSS } from "./cvTemplateStyles";

// Simple, single-page HTML cover letter — same visual language as
// CvHtmlTemplate (ink/paper colors, Now/Lato/Aileron) but its own plain
// layout, printed the same way (lib/print/printHtml.ts).
export function CoverLetterHtmlTemplate({
  doc,
  includeStyles = true,
}: {
  doc: CoverLetterDocument;
  includeStyles?: boolean;
}) {
  const { profile, job, body, date } = doc;
  const contactParts = [profile.email, profile.phone, ...profile.links].filter(Boolean);
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="cltpl-root" data-testid="cover-letter-template">
      {includeStyles && <style dangerouslySetInnerHTML={{ __html: CV_TEMPLATE_CSS }} />}

      <h1 className="cltpl-name">{profile.name || "Candidate"}</h1>
      {contactParts.length > 0 && <p className="cltpl-contact">{contactParts.join("  ·  ")}</p>}
      <hr className="cltpl-rule" />

      <p className="cltpl-date">{date}</p>
      <p className="cltpl-recipient">
        {job.company} Hiring Team
        {job.location ? <><br />{job.location}</> : null}
      </p>

      <p className="cltpl-re">Re: Application for {job.title}</p>
      <p className="cltpl-greeting">Dear Hiring Team,</p>

      {paragraphs.map((p, i) => (
        <p key={i} className="cltpl-paragraph">
          {p}
        </p>
      ))}

      <p className="cltpl-signoff">
        Best regards,
        <br />
        {profile.name || "Candidate"}
      </p>
    </div>
  );
}
