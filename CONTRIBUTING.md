# Contributing to HYD Runners

Read this before your first commit. The stack and its reasons are in [`docs/TECH_DECISIONS.md`](docs/TECH_DECISIONS.md), shared types are in [`docs/CONTRACTS.md`](docs/CONTRACTS.md), and visual rules are in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).

## Branches

`main` is the shared, always-deployable branch. Vercel deploys it to production.

- **Never push directly to `main`, and never force-push it.** Every change arrives by pull request.
- `main` must pass `pnpm verify` (lint, typecheck, unit tests, build) at every commit.

Each feature area has one long-lived feature branch, created from `main` once the foundation is on GitHub:

| Area          | Feature branch      | Topic branches                                 |
| ------------- | ------------------- | ---------------------------------------------- |
| Planning      | `feature/planning`  | `planning/<short-topic>`                       |
| Training      | `feature/training`  | `training/<short-topic>`                       |
| Community     | `feature/community` | `community/<short-topic>`                      |
| Shared / lead | n/a                 | `chore/<topic>`, `fix/<topic>`, `docs/<topic>` |

- Merge small topic branches into your feature branch by PR (a teammate reviews).
- Merge your feature branch into `main` by PR **at least every two days** when it is green, so the areas do not drift apart.
- Before opening a PR, run `git fetch && git rebase origin/main` (or merge `main` in) and fix any conflicts.
- Branch names use lowercase kebab-case, e.g. `planning/timetable-review-grid`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with the area as scope:

```
feat(scheduler): place C25K sessions into free slots
fix(community): show unverified badge on map list
test(workouts): cover log-workout validation
chore(deps): bump next to 16.4.1          # lead only
docs(contracts): document SchedulerResult
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`. Write in the imperative mood and keep the subject under 72 characters. Make one logical change per commit, and do not make commits only to raise commit counts.

## File ownership

Each area owns its feature folder, its routes and its migrations. Edit another area's files only with that owner's review.

| Area      | Owner       | Feature folders                                                                                 | Routes (`src/app/(app)/…`)                       | Tables (migrations)                                                                                                              |
| --------- | ----------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Planning  | Developer A | `src/features/identity`, `src/features/scheduler`, `src/lib/ai/anthropic.ts` (new)              | `onboarding`, `schedule`, `profile`              | `user_preferences`, `timetable_uploads`, `availability_blocks`, `scheduled_workouts`; `timetables` bucket                        |
| Training  | Developer B | `src/features/workouts` (incl. programmes), `src/features/gamification`, `src/features/reports` | `dashboard`, `programmes`, `workouts`, `reports` | `programmes`, `programme_sessions`, `enrollments`, `workout_logs`, `xp_ledger`, `badges`, `user_badges`, `streaks`, report views |
| Community | Developer C | `src/features/community`                                                                        | `community`, `events`, `map`, `coach`, `manager` | `event_rsvps`, `announcements`, `feedback`, `messages`, `coach_assignments`                                                      |
| Shared    | Lead        | everything in the next section                                                                  | `(auth)`, `api/v1/health`, `api/v1/me`           | foundation migration (`profiles`, `user_roles`, `locations`, `events`)                                                           |

Feature API routes go under `src/app/api/v1/<area-resource>/` and belong to that area.

### Shared files: do not edit independently

Changes to these need a PR labelled `shared` and the lead's approval:

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`. **Do not add, remove or upgrade dependencies on a feature branch.** Ask the lead, who adds the dependency on `main` for everyone.
- `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `.prettierrc.json`, `components.json`
- `src/lib/contracts/**` (needs every owner's approval, label `contracts`)
- `src/lib/supabase/**`, `src/lib/auth/**`, `src/lib/api/**`, `src/lib/env.ts`, `src/lib/env.server.ts`, `src/lib/ai/index.ts`, `src/lib/ai/provider.ts`, `src/proxy.ts`
- `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(app)/layout.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`
- `src/components/ui/**`, `src/components/layout/**`, `src/components/shared/**`, `src/components/brand/**`
- `supabase/config.toml`, `supabase/seed.sql`, any **already merged** migration
- `docs/TECH_DECISIONS.md`, `docs/CONTRACTS.md`, `docs/DESIGN_SYSTEM.md`, `.env.example`, `.github/**`

If you need a new shared UI component, build it inside your feature folder first, then propose moving it to `src/components/shared`.

## Database migrations

- Change the schema **only** through migrations: `pnpm db:new <area>_<what>` (e.g. `pnpm db:new training_workout_logs`). Never edit tables in the hosted dashboard.
- Never edit a migration that has been merged to `main`; write a new one.
- Every new table must enable RLS and include its policies in the same migration, plus allow/deny tests in `supabase/tests/database/<area>_*.test.sql`.
- Mirror new enums in `src/lib/contracts` in the same PR.
- Run `pnpm db:reset && pnpm db:test` before pushing.
- Only CI applies migrations to the hosted project (`supabase db push`), never a laptop. See `DEPLOYMENT.md`.

## Pull requests

Every PR must:

1. Have a clear title (Conventional Commit style) and a description of **what** and **why**, with screenshots for UI changes at mobile and desktop widths.
2. Pass `pnpm verify` locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
3. Include tests:
   - Pure logic (scheduler, XP rules, parsers) → Vitest unit tests in `tests/unit/<area>/`.
   - New screens or flows → at least one Playwright check in `tests/e2e/<area>.spec.ts`.
   - New tables or policies → pgTAP tests (`pnpm db:test`).
4. Keep secrets out of code and commits. `.env.local` is git-ignored; never commit keys.
5. Label unfinished UI with `PlaceholderNotice`, and never show sample data as real activity.
6. Get one approving review (two for `shared` or `contracts`).

Squash-merge topic branches; merge feature branches into `main` with a merge commit so each area's history stays readable.

## Local setup

See [README.md](README.md#local-setup).
