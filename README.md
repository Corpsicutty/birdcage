# Birdcage (MVP)

Mobile-first disc golf scoring app with:

- Solo scoring (no login required)
- Group sessions with 6-character join codes
- Claim existing names or add your own when joining
- Realtime group score updates through Supabase
- Session expiry after 24 hours, plus manual "End" action

## 1) Configure Supabase

1. Open your Supabase project (`Birdcage`).
2. Run `supabase/schema.sql` in the SQL editor.
3. Copy your project URL and anon key.

Create `.env` (from `.env.example`):

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 2) Install and run

```bash
npm install
npm run dev
```

If your shell says `npm` is not recognized, reinstall Node.js LTS from [nodejs.org](https://nodejs.org/) and ensure `npm` is added to PATH.

## 3) Deploy

- Push this repo to GitHub.
- Import the repo in Vercel.
- Add the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel project environment variables.
- Deploy.

## Notes

- This MVP intentionally allows anonymous access to keep entry friction-free.
- For production hardening, migrate writes to token-validated RPCs and tighten RLS policies.
