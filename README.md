# HYD Runners

> **Course project:** `dsi-monsoon-2026-06b`
>
> **Problem statement:** Adapting support to individuals: How might we determine what kind of intervention or support may be appropriate for different behavioural patterns, rather than providing the same intervention to everyone?

A beginner-friendly running, fitness and community platform for Hyderabad. It helps new runners build a **consistent habit** with plans that fit around **changing timetables**.

## Features

- **Onboarding and profile:** running experience, what gets in the way, training preferences and home spots.
- **Today dashboard:** the next session, the week's plan, streaks, XP, coins, level, badges, an evolving character and weekly challenges.
- **Programmes:** Couch to 5K, strength and conditioning, mobility and recovery plans with progress tracking.
- **Workouts:** a guided timer or manual logging. Rewards are computed on the server and granted exactly once.
- **Schedule planner:** upload a timetable (PDF or image) or enter busy times, confirm them, then generate, edit and approve a training week. Works without AI; Gemini adds image and scanned-PDF reading.
- **Reports:** weekly, monthly and yearly training summaries.
- **Community:** weekly leaderboard, announcements, feedback and in-app messages; group-run events with RSVPs; a map of parks, tracks and lake loops.
- **Staff tools:** coaches answer feedback and message runners; programme managers publish announcements, events and location updates. Roles: `runner`, `coach`, `mentor`, `programme_manager`, `admin`.

## Tech stack

Next.js 16 (App Router, TypeScript, Turbopack) · React 19 · Tailwind CSS 4 + shadcn/ui · Supabase (PostgreSQL, Auth, Storage, Row Level Security) · Zod · Recharts · Leaflet · Gemini (server-side, optional) · Vitest, Playwright and pgTAP · Vercel.

## Project structure

```
src/
  app/            routes: (marketing), (auth), (app) signed-in pages, api/v1 REST endpoints, auth/callback
  components/     ui/ (shadcn primitives), layout/, shared/, charts/, map/
  features/       one folder per area: identity, scheduler, workouts, gamification, community, reports, dashboard
  lib/            contracts/ (shared Zod schemas), supabase/ (clients, errors), auth/, api/, ai/, env
  proxy.ts        refreshes the session and redirects signed-out visitors from protected routes
supabase/
  migrations/     the only way to change the schema
  tests/database/ pgTAP Row Level Security tests
  seed.sql        local sample data (labelled "sample"); never runs in production
tests/
  unit/           Vitest
  e2e/            Playwright (desktop + mobile)
.github/workflows/
  ci.yml          lint, typecheck, unit, RLS, build and e2e on every PR
  db-deploy.yml   manual migration deploys to staging or production
```

Every table has RLS and the browser only holds the publishable key. The secret key, AI keys and privileged writes stay on the server (`server-only` imports enforce this).

## Prerequisites

- Node.js 22+
- pnpm 11 (`corepack enable`)
- Docker, running (for the local Supabase stack)

## Environment variables

Copy the template to `.env.local` in the project root (gitignored), then fill it in:

```bash
cp .env.example .env.local
```

| Variable                                                                                  | Value                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Printed by `pnpm db:start` (again with `pnpm exec supabase status`)                           |
| `NEXT_PUBLIC_SITE_URL`                                                                    | The URL the app is served on, e.g. `http://localhost:3000`; used in auth email links          |
| `AI_PROVIDER`                                                                             | `none` (default) or `gemini`                                                                  |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                                                          | Only when `AI_PROVIDER=gemini`                                                                |
| `AI_DAILY_CALL_LIMIT`                                                                     | AI calls per user per day (default `10`)                                                      |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_ATTRIBUTION`                                 | Map tiles; defaults to OpenStreetMap (light use only). Use a commercial provider for real use |
| `DEMO_SEED_TOKEN`                                                                         | Optional; enables `POST /api/v1/dev/seed-demo` in production. Leave empty                     |

Without Supabase variables the app runs in _preview mode_: every screen renders, sign-in and data are disabled. `NEXT_PUBLIC_*` values are compiled in at build time, so restart or rebuild after changing them.

## Run, build and test locally

```bash
pnpm install                          # exact versions from pnpm-lock.yaml
pnpm exec playwright install chromium
pnpm db:start                         # local Supabase in Docker: applies migrations and seed
pnpm dev                              # http://localhost:3000
```

Locally, email confirmation is off (sign-up signs you in), Studio is at http://127.0.0.1:54323 and the Mailpit inbox at http://127.0.0.1:54324. To make yourself staff, run in Studio's SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'programme_manager' from auth.users where email = 'you@example.com';
```

| Command                                        | Does                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm build` / `pnpm start`                    | Production build / serve it                                            |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | ESLint · TypeScript · Prettier                                         |
| `pnpm test`                                    | Vitest unit tests; Supabase-backed ones run when the local stack is up |
| `pnpm db:test`                                 | pgTAP RLS tests                                                        |
| `pnpm test:e2e`                                | Playwright against `pnpm start` on port 3000 (build first)             |
| `pnpm verify`                                  | lint + typecheck + unit tests + build                                  |

Full check, as CI runs it (local Supabase up):

```bash
pnpm verify && pnpm db:test
AI_PROVIDER=none pnpm test:e2e
```

`pnpm test:e2e` reuses any server already on port 3000; stop old `dev`/`start` servers first or use `PORT=3200 pnpm test:e2e`. The opt-in scheduler API integration tests run with `SCHEDULER_INTEGRATION=1` and the `.env.local` values exported.

## Supabase migrations

- Every schema change is a new file in `supabase/migrations/`, created with `pnpm db:new <name>`. Files run in order of their timestamp prefix.
- Supabase records applied migrations **by version (the timestamp) only**. Never edit, rename or reuse the version of a migration that has been applied anywhere shared; add a new migration instead.
- Reference data the app needs (programmes, sessions, badges) lives in migrations. `seed.sql` is local sample data only.
- Locally: `pnpm db:reset` rebuilds from migrations and seed (wipes data); `pnpm exec supabase migration up --local` applies new migrations and keeps data.
- Hosted projects are migrated only by the **Deploy database migrations** workflow, never from a laptop.

## Deployment

**Environments**

| Environment | Vercel                                   | Supabase project |
| ----------- | ---------------------------------------- | ---------------- |
| Production  | Production branch `main`                 | production       |
| Preview     | Every other branch and PR gets a preview | staging          |

Previews must never use production credentials: scope the production Supabase variables to **Production** only, and give **Preview** the staging project's values (and its own `NEXT_PUBLIC_SITE_URL` or none).

**Supabase (per project, in the Mumbai region)**

1. Copy the publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys from Settings → API Keys.
2. Authentication → URL Configuration: Site URL `https://hydrunners.vercel.app` (production), and redirect URLs `<site>/auth/callback` plus `https://*-<vercel-team>.vercel.app/auth/callback` for previews on staging.
3. Keep "Confirm email" on.

**Vercel**

1. Import the repository (Next.js and pnpm are detected), function region `bom1`.
2. Add the environment variables above with the scopes described.

**Migrations (GitHub Actions)**

Create two GitHub environments, `staging` and `production`, each with the variable `SUPABASE_PROJECT_ID` and the secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. Give `production` required reviewers.

Run **Actions → Deploy database migrations → Run workflow** and choose the target. The workflow prints a dry run, then applies pending migrations. Production runs only from `main`, only after CI has passed for that commit, and only when the confirm field says `migrate production`. Merging never migrates a database on its own.

**Release order**

1. Merge to `main` after CI passes; Vercel deploys production.
2. Run the migration workflow for `production` and check the dry run lists only the expected migrations.
3. Check `https://hydrunners.vercel.app/api/v1/health` reports `"supabaseConfigured":true`, then sign in and open the dashboard. Until migrations are applied the dashboard shows a "not available yet" notice instead of data.

Free Supabase projects pause after a week without activity; open the site the day before a demo.
