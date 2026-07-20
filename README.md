# JobHunter — demo slice

A live demo of the AI Job Hunter agent: search real job listings, and for any
role the agent **scores your fit** and **tailors your CV** (plus a cover letter)
to that exact posting — truthfully, in seconds.

This is the "wow" slice, not the full agent. No accounts, cron, or notifications —
just the core loop: **real jobs in → tailored CV out.**

## What it does

- Pulls live listings from **JSearch** (Google for Jobs — covers LinkedIn, Indeed,
  Glassdoor, company pages).
- Sends the job description + your master CV to **Claude**, which returns a
  0–100 match score, the reasons, a tailored CV, and a cover letter.
- Tailoring is **truthful by design**: Claude only re-emphasizes what's already in
  your master CV. It never invents experience.

Works out of the box with sample jobs even before you add any keys.

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

## Deploy to Vercel (public link in ~5 min)

1. Push this folder to a GitHub repo.
2. Go to vercel.com → **New Project** → import the repo.
3. Add the environment variables above under **Settings → Environment Variables**.
4. Deploy. You get a public URL like `https://jobhunter-demo.vercel.app`.

That URL is what you share with the client.

## Notes

- Keys stay server-side (in the API routes) — they're never exposed to the browser.
- Edit your master CV in the app via the **Master CV** button (top right), or change
  the default in `lib/masterCV.ts`.
- Stack: Next.js (App Router) + TypeScript + Tailwind. Zero runtime dependencies
  beyond React/Next.
