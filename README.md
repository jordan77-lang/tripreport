# TripReport

Offline-first collaborative trip logging PWA — GPS tracking, field journal, planning, and shared expenses.

## Local development

```bash
cd app
cp .env.example .env   # add your Mapbox + USGS keys
npm install
npm run dev
```

Open http://127.0.0.1:5173 in your browser (run the dev server yourself; do not rely on IDE-embedded browsers for Mapbox).

From the repo root you can also run `npm run dev`, `npm run build`, and `npm run kill-dev`.

## Deploy (Netlify)

1. Connect this repo at [Netlify](https://app.netlify.com).
2. Build settings are in `netlify.toml` (base: `app`, publish: `dist`).
3. Add environment variables in Netlify → Site settings → Environment variables:
   - `VITE_MAPBOX_TOKEN`
   - `VITE_USGS_KEY` (optional)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (trip recap AI)
   - `RESEND_API_KEY`, `REPORT_EMAIL_FROM` (optional — email report)

See [app/docs/supabase-setup.md](app/docs/supabase-setup.md) for Supabase project setup.
See [app/docs/recap-setup.md](app/docs/recap-setup.md) for AI report and email setup.

Push to `main` to trigger a deploy.

## Field test on Android

Install from your Netlify URL in Chrome → Add to Home screen. Sync between phones uses **Export Update** / **Import Update** on the Trip page.
