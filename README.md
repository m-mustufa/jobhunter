# JobHunter

An AI job-hunting agent for Abu Dhabi: one click searches executive,
managerial, government, technical-leadership, and senior-specialist roles
across hundreds of title and spelling variants, highlights locally recommended
roles, then generates an AI-tailored CV + cover letter for any single role you
choose to apply to.

## What it does

- Searches **Hirebase** across the complete target-role title list, filters
  results to Abu Dhabi, removes duplicates, and keeps only the past 30 days.
  Successful results are accumulated in a private server snapshot as well as
  the browser cache. A refresh puts genuinely new jobs first, updates matching
  jobs in place, and keeps older saved jobs available through pagination.
- The **LinkedIn only** toggle uses **TheirStack** to retrieve LinkedIn-source
  vacancies posted in Abu Dhabi during the past 30 days, including the full
  job description. Normal reads never contact TheirStack. Live LinkedIn syncs
  have a durable 12-hour cooldown and subsequently request only records
  discovered since the previous successful sync, excluding already-seen IDs.
- A local **Recommended** marker and filter help surface promising vacancies
  without an AI call. The UI intentionally avoids showing a percentage score
  that could underestimate the candidate or imply a guaranteed outcome.
- Click **"Tailor CV for this job"** on any single result to run one real
  **Claude** call for that job, which returns a tailored profile, reordered
  and rewritten experience bullets, a cover letter, a short gap analysis,
  and an audit trail showing which master-CV statement backs each claim.
- Tailoring is **truthful by design**: Claude only re-orders, re-emphasizes,
  and rephrases what's already in your master CV. It never invents
  experience — gaps are called out explicitly instead.
- Once tailored, **"Apply with this CV"** downloads a finished, ready-to-attach
  CV + cover letter (PDF and/or DOCX, per your Profile's CV Format setting),
  then opens the original posting. A matching "Download" button on the Cover
  Letter tab does the same for just the letter.
- A **Profile** page (contact details, summary, skills, experience,
  education, a photo, and your preferred download format) fills every
  generated document — Master CV is generated from it automatically, so the
  two can't drift apart. Fill it in manually, or upload an existing CV
  (.pdf/.docx — e.g. LinkedIn's own "Save to PDF" export) to auto-extract it
  via Claude, including pulling out an embedded photo if the file has one.
  Everything persists locally in your browser.
- Works out of the box with sample jobs even before you add any keys.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your keys (see below)
npm run dev                  # http://localhost:3000
```

## Keys

| Variable | Needed? | What it's for |
|---|---|---|
| `ANTHROPIC_API_KEY` | Required for production tailoring | Per-job CV/cover-letter generation and CV-upload extraction. Get it at console.anthropic.com. |
| `HIREBASE_API_KEY` | Required for live general listings | Powers the normal Abu Dhabi jobs listing and the Employers directory through Hirebase. |
| `THEIRSTACK_API_KEY` | Required for LinkedIn mode | Powers LinkedIn-only listings through TheirStack. |
| `BLOB_READ_WRITE_TOKEN` | Required for durable data | Private durable storage for profiles and saved listings plus the restart-safe 12-hour TheirStack credit guard. |
| `ANTHROPIC_MODEL` | Optional | Defaults to `claude-sonnet-5`. |
| `HIREBASE_MAX_RESULTS` | Optional | Saved-result cap per Hirebase refresh. Defaults to `250`. |
| `HIREBASE_SYNC_JOB_BUDGET` | Optional | Maximum provider records requested by one Hirebase refresh. Defaults to `250`. |
| `THEIRSTACK_MAX_RESULTS` | Optional | Maximum LinkedIn records returned by an eligible live sync (`25`-`250`). Defaults to `150`. |
| `SITE_PASSWORD` | Required for a public deployment | Password-gates the site so public/bot traffic cannot access private CV data or burn paid API usage. Use a strong unique value. |
| `DEMO_MODE` | Optional | Set to `true` to block all real Claude/Hirebase/TheirStack calls and use sample data — useful for local dev. Leave unset in production. |

**Jobs cache note**: the server keeps each provider's successful snapshot in
memory and private Blob storage. Normal searches reuse saved data. Hirebase
can be refreshed explicitly; TheirStack live syncs are limited to once every
12 hours and incremental refreshes return only newly discovered records where
possible. A cached LinkedIn refresh uses zero credits and reports when the next
live sync is available. Saved jobs are never removed automatically. Profile &
CV includes a **Clear saved listings** action protected by an exact `Confirm`
entry; clearing does not bypass the LinkedIn credit cooldown.
TheirStack live refreshes are refused when Blob storage is not configured, so a
server restart cannot silently bypass the paid-request cooldown.
The Recommended marker/filter is local; only the on-demand "Tailor CV for this
job" action and CV-upload extraction use paid Claude calls.

## Deploy to Vercel (public link in ~5 min)

1. Push this folder to a GitHub repo.
2. Go to vercel.com → **New Project** → import the repo.
3. Add the environment variables above under **Settings → Environment Variables**.
4. Deploy. You get a public URL like `https://jobhunter-demo.vercel.app`.

That URL is what you share with the client.

## How search works

The shared taxonomy now covers hundreds of executive, managerial, government,
oil-and-gas, technical-leadership, and senior-professional title variants. It
includes common abbreviations and reversed word orders such as `Head of X`,
`X Head`, `X Director`, `X Manager`, and `X Lead`.

Job titles searched: the original spec list (VP, AVP, GM, DGM, Business Unit
Head, Division Head, Department Head, Senior Manager, Department Manager,
Area Manager, Senior Project Manager, Project Director, Engineering Manager,
Operations Manager, Commercial Manager, Finance Manager, HR Manager, IT
Manager, Data Management Manager, Quality/QA-QC Manager, HSE Manager, Supply
Chain Manager, Procurement Manager, Contracts Manager, Business Development
Manager, Strategy and Transformation Manager, Governance/Risk/Compliance
Manager, Team Leader, Section Head, Lead) plus client-approved additions
(Managing/Executive/Senior/Portfolio Director, the C-suite — CEO/COO/CFO/
CTO/CIO/CHRO/CCO/CSO/CRO/CCO/CMO, Country Manager/Head, Regional Director/
Manager, General Counsel, Legal Manager/Counsel, Marketing Manager,
Communications Manager, Internal Audit Manager, Risk Manager, Compliance
Manager, Sustainability/ESG Manager, Investment/Treasury/Portfolio Manager,
Category/Facilities/Program Manager) — see
[lib/targetRoles.ts](lib/targetRoles.ts).

The titles are split into bounded Hirebase groups and paged within a configured
provider-record budget. TheirStack reserves most of each paid sync for
executive, government, director, and explicitly senior roles before using the
remaining capacity for broad manager/lead discovery. Every record is checked
again for Abu Dhabi and a matching managerial title, deduplicated, sorted
newest first, and merged into durable saved listing history. Defaults allow up
to 250 Hirebase results and 150 LinkedIn records per eligible live sync without
weakening the existing cache or 12-hour LinkedIn credit guard.

The dedicated **Employers** page loads its Abu Dhabi company directory from
Hirebase only when opened, reuses the saved result for 24 hours, and falls back
to the bundled reference directory if the live provider is unavailable.

## Notes

- Keys stay server-side (in the API routes) — they're never exposed to the browser.
- Edit your Profile and Master CV in the app via the **Profile & CV** button
  (top right), or change the defaults in `lib/profile.ts` / `lib/masterCV.ts`.
- Stack: Next.js (App Router) + TypeScript + Tailwind. `@react-pdf/renderer`
  and `docx` generate the downloadable PDF/DOCX files client-side
  (lazy-loaded on click, not in the main bundle); `pdf-parse` and `mammoth`
  extract text (and, best-effort, an embedded photo) from uploaded resume
  files server-side for the Profile importer.
