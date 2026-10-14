# Deployment

Production runs on **Vercel** (Next.js web app and `/api/v1`) and **Supabase Cloud** (Postgres, Auth, Storage). Both should be in or near Mumbai: Supabase region `ap-south-1`, Vercel function region `bom1`.

## 1. Supabase project (once)

1. Create a project at supabase.com in region **South Asia (Mumbai)**. Save the database password in the team password manager.
2. **Settings → API Keys:** create (or copy) the **publishable** key (`sb_publishable_…`) and a **secret** key (`sb_secret_…`). Do not use the legacy `anon` / `service_role` keys; they are deprecated by the end of 2026.
3. **Authentication → URL Configuration:**
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/auth/callback`, `https://*-<team>.vercel.app/auth/callback` (preview deployments)
4. **Authentication → Providers → Email:** keep "Confirm email" **on** in production.
5. Apply the schema through CI (step 3), not from the dashboard.

**Free plan caveat:** free projects pause after one week without activity. Before a live demo, either upgrade for that month or open the site the day before, and check `/api/v1/health`.

## 2. Vercel project (once)

1. Import the GitHub repository in Vercel. The framework is detected as Next.js and pnpm is used from `packageManager`.
2. **Settings → Functions → Region:** `bom1` (Mumbai).
3. **Settings → Environment Variables:** add the variables below for **Production** and **Preview**.
4. The Production branch is `main`. Every PR gets a preview URL.

Vercel's Hobby plan is for **non-commercial** use. That is fine for a student demo. Move to Pro before the product is monetised.

## 3. Database migrations via GitHub Actions

`.github/workflows/db-deploy.yml` runs `supabase db push` when a merge to `main` changes `supabase/migrations/`. Configure it in **GitHub → Settings → Secrets and variables → Actions**:

| Kind     | Name                    | Value                                                            |
| -------- | ----------------------- | ---------------------------------------------------------------- |
| Variable | `SUPABASE_PROJECT_ID`   | Project ref (the id in the dashboard URL)                        |
| Secret   | `SUPABASE_ACCESS_TOKEN` | Personal access token from supabase.com/dashboard/account/tokens |
| Secret   | `SUPABASE_DB_PASSWORD`  | Database password from step 1                                    |

Until `SUPABASE_PROJECT_ID` is set, the workflow is skipped. For the very first deploy you can trigger it manually (Actions → "Deploy database migrations" → Run workflow).

Do not run `supabase db push` from a laptop. If the hosted schema and the migration history ever disagree, follow the "Sync errors" steps in the Supabase migrations guide and fix it in a PR.

## Environment variables

| Name                                   | Where           | Required                     | Purpose                                                      |
| -------------------------------------- | --------------- | ---------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Vercel (all)    | yes                          | `https://<ref>.supabase.co`                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel (all)    | yes                          | `sb_publishable_…`; safe in the browser because RLS applies  |
| `NEXT_PUBLIC_SITE_URL`                 | Vercel (all)    | yes                          | Public URL, used for auth email links                        |
| `SUPABASE_SECRET_KEY`                  | Vercel (server) | for AI jobs / admin tasks    | `sb_secret_…`; **bypasses RLS**; never `NEXT_PUBLIC_`        |
| `AI_PROVIDER`                          | Vercel          | no (default `none`)          | `anthropic` or `none` (kill switch → deterministic fallback) |
| `AI_MODEL`                             | Vercel          | no                           | Default `claude-haiku-5-5`                                   |
| `ANTHROPIC_API_KEY`                    | Vercel (server) | when `AI_PROVIDER=anthropic` | Claude API key                                               |
| `AI_DAILY_CALL_LIMIT`                  | Vercel          | no                           | Per-user daily AI calls (default 10)                         |
| `NEXT_PUBLIC_MAP_TILE_URL`             | Vercel          | no                           | Leaflet tile template; default OpenStreetMap standard tiles  |
| `NEXT_PUBLIC_MAP_ATTRIBUTION`          | Vercel          | no                           | Attribution HTML for the tile provider                       |

`NEXT_PUBLIC_*` values are compiled into the browser bundle at build time, so redeploy after changing them.

## Map tiles

The default `tile.openstreetmap.org` server is donation-funded. Its usage policy allows light use with visible attribution but gives no guarantee and can block heavy or commercial traffic. It is acceptable for development and the demo. Before real usage, switch `NEXT_PUBLIC_MAP_TILE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` to a provider whose terms allow production traffic. No code change is needed.

## Release checklist

- [ ] CI green on `main` (lint, typecheck, unit, RLS, build, e2e)
- [ ] Migrations applied (`db-deploy` run succeeded)
- [ ] `https://<domain>/api/v1/health` returns `{"data":{"status":"ok",…,"supabaseConfigured":true}}`
- [ ] Sign-up → confirmation email → onboarding works on the production URL
- [ ] Supabase project not paused; plan checked for the demo period
