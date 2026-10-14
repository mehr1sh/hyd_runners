# HYD Runners

> **Course project:** `dsi-monsoon-2026-06b`
>
> **Problem statement:** Adapting support to individuals: How might we determine what kind of intervention or support may be appropriate for different behavioural patterns, rather than providing the same intervention to everyone?

A beginner-friendly running, fitness and community platform for Hyderabad. It helps new runners build a **consistent habit** with plans that fit around **changing timetables**.

This repository holds the shared application foundation: routes, layout, design system, contracts, auth and database foundation. Feature work happens on the three feature branches described in [CONTRIBUTING.md](CONTRIBUTING.md).

| Doc                                              | What it covers                                           |
| ------------------------------------------------ | -------------------------------------------------------- |
| [docs/TECH_DECISIONS.md](docs/TECH_DECISIONS.md) | Approved stack, pinned versions, architecture rules      |
| [docs/CONTRACTS.md](docs/CONTRACTS.md)           | Shared types, ids, date formats, API envelope and errors |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)   | Brand palette, contrast decisions, components            |
| [CONTRIBUTING.md](CONTRIBUTING.md)               | Branches, commits, file ownership, PR and testing rules  |
| [DEPLOYMENT.md](DEPLOYMENT.md)                   | Vercel + Supabase setup and environment variables        |
| [PROJECT_STATUS.md](PROJECT_STATUS.md)           | What is done, what is next, who owns what                |

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui · Supabase (PostgreSQL, Auth, Storage, RLS) · Zod · Recharts · Leaflet · Claude (server-side, optional) · Vitest + Playwright · Vercel.

## Local setup

**Prerequisites:** Node.js 22+, pnpm 11 (`corepack enable`), and Docker (for the local Supabase stack).

```bash
pnpm install                 # installs exact versions from pnpm-lock.yaml
pnpm exec playwright install chromium

pnpm db:start                # starts local Supabase in Docker, applies migrations and seed
cp .env.example .env.local   # then paste the API URL, Publishable key and Secret key printed by db:start
                             # (run `pnpm exec supabase status` to see them again)
pnpm dev                     # http://localhost:3000
```

- Local Studio (database UI): http://127.0.0.1:54323
- Local email inbox (Mailpit): http://127.0.0.1:54324. Email confirmation is off locally, so sign-up signs you in straight away.
- **Without Supabase** (`.env.local` empty), the app runs in _preview mode_: every screen renders, and sign-in and data are disabled.

To give yourself a staff role locally, run this in Studio's SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'programme_manager' from auth.users where email = 'you@example.com';
```

## Scripts

| Command                                        | Does                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                                     | Dev server (Turbopack)                                                |
| `pnpm build` / `pnpm start`                    | Production build / serve it                                           |
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | ESLint · TypeScript · Prettier                                        |
| `pnpm test`                                    | Vitest unit tests (`tests/unit`)                                      |
| `pnpm test:e2e`                                | Playwright, desktop + mobile (`tests/e2e`). Needs `pnpm build` first. |
| `pnpm verify`                                  | lint + typecheck + unit tests + build: run before every PR            |
| `pnpm db:start` / `db:stop`                    | Local Supabase stack                                                  |
| `pnpm db:new <name>`                           | New migration file                                                    |
| `pnpm db:reset`                                | Rebuild the local DB from migrations + seed                           |
| `pnpm db:test`                                 | pgTAP RLS tests (`supabase/tests`)                                    |
| `pnpm db:types`                                | Generate `src/lib/supabase/database.types.ts` from the local schema   |

## Project structure

```
src/
  app/
    (marketing)/          public landing page
    (auth)/               sign-in, sign-up
    (app)/                signed-in app: dashboard, onboarding, schedule, programmes,
                          workouts, reports, community, events, map, profile, coach, manager
    api/v1/               REST endpoints (shared with the future mobile app)
    auth/callback/        email confirmation / OAuth code exchange
  components/
    ui/                   shadcn/ui primitives (shared — lead)
    layout/ brand/ shared/ charts/ map/
  features/               one folder per feature area (identity, scheduler, workouts,
                          gamification, community, reports)
  lib/
    contracts/            shared Zod schemas + types (single source of truth)
    supabase/             browser, server, admin (secret) clients and the session proxy helper
    auth/                 current user, role guard, API caller resolution
    api/                  response envelope helpers
    ai/                   provider-neutral AI interface (server only)
  proxy.ts                session refresh + redirect for protected routes
supabase/
  migrations/             SQL migrations (only way to change the schema)
  tests/database/         pgTAP tests
  seed.sql                local sample data (clearly labelled)
tests/
  unit/  e2e/
```

## Security notes

- Every table has Row Level Security. The browser only ever holds the publishable key.
- The secret key, AI keys, timetable processing and privileged writes stay on the server (`server-only` imports enforce this).
- Never commit `.env.local` or any real key.
