# JobHunter

An AI job-hunting agent for Abu Dhabi: one click searches every open vacancy
across ~30 senior/functional titles (VP down to Team Lead), scores your fit
against each one, and generates a tailored CV + cover letter for every match —
truthfully, in one batch.

## What it does

- Searches **JSearch** (Google for Jobs — covers LinkedIn, Indeed, Glassdoor,
  company pages) across the target-role query list, filters results to Abu
  Dhabi, and dedupes them.
- Streams each vacancy through **Claude**, which returns a 0–100 match score
  (bucketed into Strong / Good / Partial / Limited match tiers), the reasons,
  a tailored CV, a cover letter, a short gap analysis, and an audit trail
  showing which master-CV statement backs each tailored-CV claim.
- Tailoring is **truthful by design**: Claude only re-orders, re-emphasizes,
  and rephrases what's already in your master CV. It never invents
  experience — gaps are called out explicitly instead.
- **"Apply with this CV"** opens the original posting and downloads a
  finished, ready-to-attach CV as both PDF and DOCX — no manual reformatting.
  A matching "Download cover letter" button does the same for the letter.
- A **Profile** section (contact details: name, title, location, email,
  phone, links) fills the header of every generated document. Fill it in
  manually, or upload an existing CV (.pdf/.docx — e.g. LinkedIn's own "Save
  to PDF" export) to auto-extract it via Claude. Profile and Master CV
  persist locally in your browser.
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
| `ANTHROPIC_API_KEY` | Yes (for tailoring) | Scoring + CV/cover-letter generation. Get it at console.anthropic.com. |
| `JSEARCH_API_KEY` | Optional | Live jobs. Without it, the app serves realistic sample listings. Get it on RapidAPI (JSearch). |
| `ANTHROPIC_MODEL` | Optional | Defaults to `claude-sonnet-5`. |

**RapidAPI quota note**: each "Find & tailor all matches" click runs ~9
JSearch calls (one per grouped title query) to cover all ~30 target titles.
JSearch's free RapidAPI tier has a limited monthly request quota — heavy use
may need a paid tier.

## Deploy to Vercel (public link in ~5 min)

1. Push this folder to a GitHub repo.
2. Go to vercel.com → **New Project** → import the repo.
3. Add the environment variables above under **Settings → Environment Variables**.
4. Deploy. You get a public URL like `https://jobhunter-demo.vercel.app`.

That URL is what you share with the client.

## How search works

Job titles searched: VP, AVP, GM, DGM, Business Unit Head, Division Head,
Department Head, Senior Manager, Department Manager, Area Manager, Senior
Project Manager, Project Director, Engineering Manager, Operations Manager,
Commercial Manager, Finance Manager, HR Manager, IT Manager, Data Management
Manager, Quality/QA-QC Manager, HSE Manager, Supply Chain Manager,
Procurement Manager, Contracts Manager, Business Development Manager,
Strategy and Transformation Manager, Governance/Risk/Compliance Manager,
Team Leader, Section Head, Lead — see [lib/targetRoles.ts](lib/targetRoles.ts).

These are grouped into ~9 combined queries (`lib/targetRoles.ts` →
`QUERY_GROUPS`) to keep API usage bounded, then every result is filtered to
Abu Dhabi server-side, deduped, and capped at 30 vacancies per batch.

The **Employers** panel (top right) is a browsable reference list of major
Abu Dhabi government, GRE, and private-sector employers from the agent spec —
informational only, not wired into the automated search.

## Notes

- Keys stay server-side (in the API routes) — they're never exposed to the browser.
- Edit your Profile and Master CV in the app via the **Profile & CV** button
  (top right), or change the defaults in `lib/profile.ts` / `lib/masterCV.ts`.
- Stack: Next.js (App Router) + TypeScript + Tailwind. Batch analysis streams
  via a native `ReadableStream` (NDJSON). Four extra runtime dependencies
  beyond React/Next: `@react-pdf/renderer` and `docx` generate the
  downloadable PDF/DOCX files client-side (lazy-loaded on click, not in the
  main bundle); `pdf-parse` and `mammoth` extract text from uploaded resume
  files server-side for the Profile importer.
