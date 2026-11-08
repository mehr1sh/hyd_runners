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
  ci.yml          lint, format, typecheck, RLS, unit + integration, build and e2e on every PR
  db-deploy.yml   manual dry run of pending migrations against the hosted project (no writes)
  db-apply.yml    manual apply of pending migrations to the hosted project
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
| `DEMO_SEED_ENABLED`, `DEMO_SEED_TOKEN`                                                    | Optional, local only; see below. Leave empty                                                  |

**Demo seed.** `POST /api/v1/dev/seed-demo` creates or resets the labelled demo accounts (`demo.runner@hydrunners.test` and three sample runners). It is off unless `DEMO_SEED_ENABLED=true` and `DEMO_SEED_TOKEN` is at least 32 characters, and it always answers 404 on Vercel Production and Preview. Each run generates a new random password for the demo runner and returns it once in the response:

```bash
curl -X POST -H "Authorization: Bearer $DEMO_SEED_TOKEN" http://localhost:3000/api/v1/dev/seed-demo
```

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

Tests that create accounts or write data run only when `NEXT_PUBLIC_SUPABASE_URL` points at the local stack (`127.0.0.1`/`localhost`); they skip themselves against any hosted project. To check a deployment without writing anything, run the read-only spec as the dedicated test account:

```bash
PLAYWRIGHT_BASE_URL=https://<deployment> E2E_RUNNER_EMAIL=… E2E_RUNNER_PASSWORD=… pnpm exec playwright test test-account smoke app-shells
```

## Password reset

1. **Sign in → "Forgot password?"** opens `/forgot-password`. The email is validated, then `resetPasswordForEmail` sends a link whose `redirectTo` is `NEXT_PUBLIC_SITE_URL` + `/auth/callback?next=/reset-password` (never the request's Host header). Every well-formed request shows the same confirmation, whether or not the account exists and even when Supabase errors or rate-limits; errors are only logged on the server.
2. **The email link** goes to Supabase's `/auth/v1/verify`, which redirects to `/auth/callback?code=…`. The callback exchanges the PKCE code for a session, so the link has to be opened in the browser that requested it. A recovery session always continues to `/reset-password`; any other `next` must be a same-origin relative path.
3. **`/reset-password`** asks for the new password twice (the sign-up rule: at least 8 characters), calls `updateUser`, signs out every other session and opens the dashboard with a "Password updated" notice. Without a session it explains how to request a new link.
4. **Expired, used or invalid links** (a failed code exchange, or Supabase's `?error=…&error_code=otp_expired`) land on `/forgot-password` with "This reset link is invalid or has expired. Request a new one." The error text from the URL is never shown.

Supabase must allow the callback URL **with a query string**, which is why each redirect entry ends in `**`. Locally `supabase/config.toml` allows `http://localhost:*/auth/callback**` and `http://127.0.0.1:*/auth/callback**`; it takes effect on the next `pnpm db:start`. Reset emails appear in Mailpit at http://127.0.0.1:54324.

## Supabase migrations

- Every schema change is a new file in `supabase/migrations/`, created with `pnpm db:new <name>`. Files run in order of their timestamp prefix.
- Supabase records applied migrations **by version (the timestamp) only**. Never edit, rename or reuse the version of a migration that has been applied anywhere shared; add a new migration instead.
- Reference data the app needs (programmes, sessions, badges) lives in migrations. `seed.sql` is local sample data only.
- Locally: `pnpm db:reset` rebuilds from migrations and seed (wipes data); `pnpm exec supabase migration up --local` applies new migrations and keeps data.
- Hosted projects are migrated only by the **Apply production database migrations** workflow (`db-apply.yml`), never from a laptop.

## Deployment

Vercel Production (branch `main`) and Preview (every other branch and PR) use the **same Supabase project**. Previews therefore act on real data, so they get only the publishable key:

| Variable                                                           | Production | Preview  |
| ------------------------------------------------------------------ | ---------- | -------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes        | yes      |
| `NEXT_PUBLIC_SITE_URL` = `https://hydrunners.vercel.app`           | yes        | yes      |
| `SUPABASE_SECRET_KEY`                                              | yes        | **no**   |
| `DEMO_SEED_ENABLED`, `DEMO_SEED_TOKEN`                             | **no**     | **no**   |
| AI and map variables                                               | yes        | optional |

On a Preview deployment, RLS applies to everything, sign-up is turned off, the demo seed is disabled and saving workouts (which needs the secret key) shows "not available on this deployment". Sign in with a dedicated test account that has only the `runner` role; never give test accounts staff roles, since staff actions such as announcements and events are visible in production. Previews never run migrations, and a branch that adds a migration previews against the current schema.

**Supabase (Mumbai region)**

1. Settings → API Keys: the publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys. The secret key goes only in server-side variables; the build refuses a secret key in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Authentication → URL Configuration: Site URL `https://hydrunners.vercel.app`, redirect URL `https://hydrunners.vercel.app/auth/callback**` (the `**` admits the `?next=…` query that sign-up and password-reset links carry). Keep "Confirm email" on. Preview deployments send links to production (`NEXT_PUBLIC_SITE_URL`), so no preview pattern is needed, and a reset started on a preview cannot be completed there. Supabase's built-in email service only delivers to project team members and is heavily rate-limited; set up custom SMTP (Authentication → Emails) before relying on password reset for runners.

**Vercel:** import the repository (Next.js and pnpm are detected), set the function region to `bom1`, and add the variables with the scopes above.

**Migrations (GitHub Actions)**

The GitHub environment `production` holds the variable `SUPABASE_PROJECT_ID` and the secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. Configure it under **Settings → Environments → production** with the repository owner as a **required reviewer**, **Prevent self-review** off (a single maintainer must be able to approve their own run), **Allow administrators to bypass** off, and **Deployment branches** limited to `main`. Until those rules are set, the typed confirmation, the project-ID check and the CI gate are the only protections.

There are two manual workflows, both run from `main`, both using that environment, and both in one concurrency group so they never run at the same time:

1. **Actions → Preview production database migrations → Run workflow**, type `preview production`. Checks that CI passed for that exact commit on `main`, then prints `supabase db push --dry-run`. It writes nothing.
2. **Actions → Apply production database migrations → Run workflow**, type `migrate production`. Waits for the environment approval (once configured), repeats the CI check and the dry run, then applies the pending migrations.

Nothing else migrates the hosted database: not merges, not Vercel builds, not tests. CI also fails if two migrations share a version.

**Release order**

1. Merge to `main` after CI passes; Vercel deploys production.
2. Run the preview workflow and check the dry run lists only the expected migrations, then run the apply workflow.
3. Check `https://hydrunners.vercel.app/api/v1/health` reports `"supabaseConfigured":true`, then sign in and open the dashboard. Until migrations are applied the dashboard shows a "not available yet" notice instead of data.

Free Supabase projects pause after a week without activity; open the site the day before a demo.
