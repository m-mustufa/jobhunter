import { CVDocument } from "../cvDocument";
import { CV_TEMPLATE_2_CSS } from "./cvTemplate2Styles";

// Second, fully custom CV design ("Sidebar Blue") ported from a
// user-supplied reference (cv-template-2-semantic.css/html, "Richard
// Sanchez — Marketing Manager CV"). Same data-driven, native-print approach
// as CvHtmlTemplate: printed via lib/print/printHtml.ts, no fixed page
// count.
//
// Information architecture deliberately matches CvHtmlTemplate (Template 1)
// rather than the literal reference: sidebar carries Skills/Education/
// Certifications/Languages as plain lists, main content carries Profile +
// Work Experience. The reference's own layout (Profile Info in the sidebar,
// Education as a second dated timeline next to Experience) looked broken
// against real data — a full skills/certifications list overflowed the
// reference's fixed single page, and Education (stored as flat undated
// strings, not a start/end range) left a large empty box in a timeline
// built for dated multi-line entries. The sidebar's own "Reference" card
// (referee contact) stays dropped, per the original decision.

function ProfileIcon() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <circle cx={32} cy={20} r={12} fill="currentColor" />
      <path d="M10 54c2-14 12-22 22-22s20 8 22 22Z" fill="currentColor" />
    </svg>
  );
}

function GearsIcon() {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <path
        d="M27 12h10l2 7 6 3 7-3 5 9-5 5v7l5 5-5 9-7-3-6 3-2 7H27l-2-7-6-3-7 3-5-9 5-5v-7l-5-5 5-9 7 3 6-3 2-7Zm5 14a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"
        fill="currentColor"
      />
      <circle cx={47} cy={17} r={8} fill="currentColor" />
      <circle cx={47} cy={17} r={3} fill="#174983" />
    </svg>
  );
}

// Splits an ExperienceEntry's free-text "dates" (e.g. "2021 - Present",
// "2018–2022") into the timeline's two-row year column. Falls back to
// putting the whole string on the top row if it doesn't split cleanly.
function splitYears(dates: string): [string, string] {
  const parts = dates.split(/\s*[-–—]\s*/).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [parts[0] ?? "", ""];
}

function SidebarList({ heading, items, compact = false }: { heading: string; items: string[]; compact?: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className="cvtpl2-sidebar-section">
      <h2 className="cvtpl2-sidebar-heading">{heading}</h2>
      <ul className={`cvtpl2-sidebar-list${compact ? " cvtpl2-compact-list" : ""}`}>
        {items.map((item, i) => (
          <li key={`${item}-${i}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function CvHtmlTemplate2({ doc, includeStyles = true }: { doc: CVDocument; includeStyles?: boolean }) {
  const { profile, summary, skills, experience, education } = doc;

  return (
    <div className="cvtpl2-page" data-testid="cv-template">
      {includeStyles && <style dangerouslySetInnerHTML={{ __html: CV_TEMPLATE_2_CSS }} />}

      <aside className="cvtpl2-sidebar">
        <div className="cvtpl2-portrait-frame" aria-hidden="true">
          {profile.photo ? <img src={profile.photo} alt="" /> : (profile.name || "C").trim().charAt(0).toUpperCase()}
        </div>

        <SidebarList heading="Skills" items={skills} />
        <SidebarList heading="Education" items={education} />
        <SidebarList heading="Certifications" items={profile.certifications} />
        <SidebarList heading="Languages" items={profile.languages} compact />
      </aside>

      <main className="cvtpl2-content">
        <header className="cvtpl2-identity-header">
          <h1>{(profile.name || "Candidate").toUpperCase()}</h1>
          {!!profile.title && <p className="cvtpl2-role">{profile.title}</p>}
          <div className="cvtpl2-identity-rule" />
          <address className="cvtpl2-contact-row">
            {!!profile.email && <span>{profile.email}</span>}
            {!!profile.phone && <span>{profile.phone}</span>}
            {!!profile.location && <span>{profile.location}</span>}
          </address>
        </header>

        <div className="cvtpl2-resume-body">
          {!!summary && (
            <section className="cvtpl2-timeline-section cvtpl2-profile-section">
              <div className="cvtpl2-section-title-row">
                <span className="cvtpl2-section-icon">
                  <ProfileIcon />
                </span>
                <h2>Profile</h2>
              </div>
              <p className="cvtpl2-profile-text">{summary}</p>
            </section>
          )}

          {experience.length > 0 && (
            <section className="cvtpl2-timeline-section cvtpl2-experience-section">
              <div className="cvtpl2-section-title-row">
                <span className="cvtpl2-section-icon">
                  <GearsIcon />
                </span>
                <h2>Experience</h2>
              </div>
              <div className="cvtpl2-timeline-list">
                {experience.map((entry, i) => {
                  const [yearStart, yearEnd] = splitYears(entry.dates);
                  return (
                    <article className="cvtpl2-timeline-item" key={`${entry.company}-${entry.role}-${i}`}>
                      <div className="cvtpl2-timeline-years">
                        {!!yearStart && <span>{yearStart}</span>}
                        {!!yearEnd && <span>{yearEnd}</span>}
                      </div>
                      <div className="cvtpl2-timeline-content">
                        {!!entry.role && <h3>{entry.role}</h3>}
                        {!!entry.company && <p className="cvtpl2-institution">{entry.company}</p>}
                        {entry.bullets.length > 0 && (
                          <ul>
                            {entry.bullets.map((bullet, bi) => (
                              <li key={bi}>{bullet}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
