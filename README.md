# JobHunter

An AI job-hunting agent for Abu Dhabi: one click searches every open vacancy
across ~65 senior/functional titles (VP down to Team Lead), scores your fit
against each one instantly for free, then generates a truthful, AI-tailored
CV + cover letter for any single role you choose to apply to.

## What it does

- Searches **JSearch** (Google for Jobs — covers LinkedIn, Indeed, Glassdoor,
  company pages) across the target-role query list, filters results to Abu
  Dhabi, and dedupes them. Results are cached locally with a timestamp — a
  page reload restores them instantly with no new API calls; a "Refresh
  listings" button re-fetches on demand.
- Every result is scored **instantly and for free** with a local
  keyword-based heuristic (no AI call) — no waiting, no cost, just to help
  you triage which vacancies are worth a closer look.
- Click **"Tailor CV for this job"** on any single result to run one real
  **Claude** call for that job, which returns a 0–100 match score (bucketed
  into Strong / Good / Partial / Limited match tiers), the reasons, a
  tailored CV, a cover letter, a short gap analysis, and an audit trail
  showing which master-CV statement backs each tailored-CV claim.
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
| `ANTHROPIC_API_KEY` | Yes (for tailoring) | Per-job scoring + CV/cover-letter generation, and CV-upload extraction. Get it at console.anthropic.com. |
| `JSEARCH_API_KEY` | Optional | Live jobs. Without it, the app serves realistic sample listings. Get it on RapidAPI (JSearch). |
| `ANTHROPIC_MODEL` | Optional | Defaults to `claude-sonnet-5`. |
| `SITE_PASSWORD` | Recommended | Password-gates the whole site so public/bot traffic can't burn paid API usage. Unset = no gate. |
| `DEMO_MODE` | Optional | Set to `true` to block all real Claude/JSearch calls and use sample data + a free heuristic preview everywhere — useful for local dev. |

**RapidAPI quota note**: each search/refresh runs ~16 JSearch calls (one per
grouped title query) to cover all ~65 target titles. JSearch's free RapidAPI
tier has a limited monthly request quota — heavy use may need a paid tier.
Scoring itself is free and local; only the on-demand "Tailor CV for this job"
action and CV-upload extraction use paid Claude calls.

## Deploy to Vercel (public link in ~5 min)

1. Push this folder to a GitHub repo.
2. Go to vercel.com → **New Project** → import the repo.
3. Add the environment variables above under **Settings → Environment Variables**.
4. Deploy. You get a public URL like `https://jobhunter-demo.vercel.app`.

That URL is what you share with the client.

## How search works

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

These are grouped into ~16 combined queries (`lib/targetRoles.ts` →
`QUERY_GROUPS`) to keep API usage bounded, then every result is filtered to
Abu Dhabi server-side, deduped, and capped at 30 vacancies per search.

The **Employers** panel (top right) is a browsable reference list of major
Abu Dhabi government, GRE, and private-sector employers from the agent spec —
informational only, not wired into the automated search.

## Notes

- Keys stay server-side (in the API routes) — they're never exposed to the browser.
- Edit your Profile and Master CV in the app via the **Profile & CV** button
  (top right), or change the defaults in `lib/profile.ts` / `lib/masterCV.ts`.
- Stack: Next.js (App Router) + TypeScript + Tailwind. `@react-pdf/renderer`
  and `docx` generate the downloadable PDF/DOCX files client-side
  (lazy-loaded on click, not in the main bundle); `pdf-parse` and `mammoth`
  extract text (and, best-effort, an embedded photo) from uploaded resume
  files server-side for the Profile importer.
