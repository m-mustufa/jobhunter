import { CVDocument } from "../cvDocument";
import { CV_TEMPLATE_CSS, INK, PAPER } from "./cvTemplateStyles";

// Data-driven HTML/CSS CV — any number of skills/experience entries/bullets,
// no fixed page count. Visual design matches the Fahad Mohamed Ahmed
// reference PDF (public/fahad-mohamed-cv-editable.html): same colors,
// fonts, header/photo treatment, sidebar/timeline structure. Printed via
// the browser's native print-to-PDF (lib/print/printHtml.ts) — no
// html2canvas/jsPDF — so page breaks fall wherever the content naturally
// runs long, not at fixed points.

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <path fill={INK} d="M6.6 10.8c1.3 2.6 3.4 4.7 6 6l2-2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 18.4 3 4c0-.6.4-1 1-1h3.9c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.1 2.3Z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <rect x={2} y={4} width={20} height={16} rx={2} fill={INK} />
      <path d="m3.5 6 8.5 6.5L20.5 6" fill="none" stroke={PAPER} strokeWidth={1.7} />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <path fill={INK} d="M12 2a7.5 7.5 0 0 0-7.5 7.5c0 5.6 6.6 11.6 6.9 11.9.3.3.9.3 1.2 0 .3-.3 6.9-6.3 6.9-11.9A7.5 7.5 0 0 0 12 2Zm0 10.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <path fill="none" stroke={INK} strokeWidth={2.2} d="M10 14a4.9 4.9 0 0 0 7 0l3-3a4.95 4.95 0 0 0-7-7l-1.5 1.5M14 10a4.9 4.9 0 0 0-7 0l-3 3a4.95 4.95 0 0 0 7 7l1.5-1.5" />
    </svg>
  );
}
function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden="true">
      <circle cx={12} cy={8} r={4} fill={PAPER} />
      <path fill={PAPER} d="M4 22c0-5 3.6-9 8-9s8 4 8 9H4Z" />
    </svg>
  );
}
function WorkIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden="true">
      <rect x={2} y={8} width={20} height={12} rx={1.5} fill={PAPER} />
      <path fill="none" stroke={PAPER} strokeWidth={2} d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path fill="none" stroke={INK} strokeWidth={1.2} d="M2 12h20" />
    </svg>
  );
}

function SidebarSection({
  heading,
  items,
  className = "",
}: {
  heading: string;
  items: string[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className={`cvtpl-sidebar-section ${className}`.trim()}>
      <h2 className="cvtpl-sidebar-heading">{heading}</h2>
      <ul className="cvtpl-bullet-list">
        {items.map((item, i) => (
          <li key={`${item}-${i}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: string }) {
  return (
    <h2 className="cvtpl-heading">
      <span className="icon-badge">{icon}</span>
      <span className="heading-text">{children}</span>
    </h2>
  );
}

export function CvHtmlTemplate({ doc, includeStyles = true }: { doc: CVDocument; includeStyles?: boolean }) {
  const { profile, summary, skills, experience, education } = doc;

  return (
    <div className="cvtpl-root" data-testid="cv-template">
      {includeStyles && <style dangerouslySetInnerHTML={{ __html: CV_TEMPLATE_CSS }} />}

      <header className="cvtpl-header">
        <h1 className="cvtpl-name">{(profile.name || "Candidate").toUpperCase()}</h1>
        {!!profile.title && <p className="cvtpl-title">{profile.title.toUpperCase()}</p>}
      </header>

      <div className="cvtpl-photo" aria-hidden="true">
        {profile.photo ? (
          <img src={profile.photo} alt="" />
        ) : (
          (profile.name || "C").trim().charAt(0).toUpperCase()
        )}
      </div>

      <div className="cvtpl-grid">
        <aside className="cvtpl-sidebar">
          <section className="cvtpl-sidebar-section">
            <h2 className="cvtpl-sidebar-heading">Contact</h2>
            <ul className="cvtpl-contact-list">
              {!!profile.phone && (
                <li>
                  <span className="icon"><PhoneIcon /></span>
                  <span>{profile.phone}</span>
                </li>
              )}
              {!!profile.email && (
                <li>
                  <span className="icon"><MailIcon /></span>
                  <span>{profile.email}</span>
                </li>
              )}
              {!!profile.location && (
                <li>
                  <span className="icon"><PinIcon /></span>
                  <span>{profile.location}</span>
                </li>
              )}
              {profile.links.map((link, i) => (
                <li key={`${link}-${i}`}>
                  <span className="icon"><LinkIcon /></span>
                  <span>{link}</span>
                </li>
              ))}
            </ul>
          </section>

          <SidebarSection heading="Skills" items={skills} />
          <SidebarSection
            heading="Education"
            items={education}
            className="cvtpl-education-section"
          />
          <SidebarSection heading="Certifications" items={profile.certifications} />
          <SidebarSection heading="Languages" items={profile.languages} />
        </aside>

        <main className="cvtpl-main">
          <div className="cvtpl-page-gutter">
            <div className="cvtpl-timeline">
              {!!summary && (
                <section className="cvtpl-content-section">
                  <SectionHeading icon={<ProfileIcon />}>Profile</SectionHeading>
                  <p className="cvtpl-profile-text">{summary}</p>
                </section>
              )}

              {experience.length > 0 && (
                <section className="cvtpl-content-section">
                  <SectionHeading icon={<WorkIcon />}>Work Experience</SectionHeading>
                  {experience.map((entry, index) => (
                    <article key={`${entry.company}-${entry.role}-${index}`} className="cvtpl-entry">
                      <div className="cvtpl-entry-lead">
                        <div className="cvtpl-entry-header">
                          <div>
                            {!!entry.company && <h3 className="cvtpl-entry-company">{entry.company}</h3>}
                            {!!entry.role && <p className="cvtpl-entry-role">{entry.role}</p>}
                          </div>
                          {!!entry.dates && <p className="cvtpl-entry-dates">{entry.dates}</p>}
                        </div>
                        {entry.bullets.length > 0 && (
                          <ul className="cvtpl-bullets">
                            <li>{entry.bullets[0]}</li>
                          </ul>
                        )}
                      </div>
                      {entry.bullets.length > 1 && (
                        <ul className="cvtpl-bullets cvtpl-bullets--continued">
                          {entry.bullets.slice(1).map((bullet, bulletIndex) => (
                            <li key={`${bulletIndex + 1}-${bullet.slice(0, 24)}`}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  ))}
                </section>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
