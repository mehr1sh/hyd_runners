# Project status

_Last updated: 14 Oct 2026 · Foundation and schedule planner on `main`; runner experience and identity/community integrated on `integrate/all-features` (PR to `main`)._

## Phase 0 — Foundation (lead) ✅

- [x] Next.js 16.4 app, pnpm, TypeScript strict, Tailwind 4, shadcn/ui (Radix)
- [x] Brand design system (palette sampled from logo, WCAG AA contrast documented)
- [x] Responsive app shell: desktop sidebar, mobile tab bar + "More" sheet, skip link
- [x] Public landing page, sign-in / sign-up (working with Supabase), auth callback, sign-out
- [x] Route shells: dashboard, onboarding, schedule, programmes, workouts, reports, community, events, map, profile, coach, manager
- [x] Not-found, error, global-error, loading and empty states; placeholder notices on unfinished areas
- [x] Shared contracts (`src/lib/contracts`) and `docs/CONTRACTS.md`
- [x] Supabase foundation migration: `profiles`, `user_roles`, `locations`, `events` with RLS, sign-up trigger, role helpers
- [x] `/api/v1/health`, `/api/v1/me` (cookie or bearer token)
- [x] Tests: Vitest unit, pgTAP RLS, Playwright desktop + mobile (incl. full sign-up flow)
- [x] CI workflow and migration-deploy workflow
- [x] Push to GitHub `main` (`RCTS-IIITH/dsi-monsoon-2026-06b`)
- [ ] Create Vercel + Supabase cloud projects and set env vars (`DEPLOYMENT.md`)
- [ ] Create `feature/planning`, `feature/training`, `feature/community` from `main`

## Phase 1 — First proof of concept (parallel)

Gate: a new runner can upload a timetable, confirm it, see a week of C25K sessions in free slots, log one and earn XP.

| Area      | Owner             | First milestone                                                                                                            |
| --------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Planning  | Developer A (TBD) | Onboarding + preferences; timetable upload → extraction (AI + fallback) → review → availability; scheduler places sessions |
| Training  | Developer B (TBD) | C25K programme data + enrolment; log workout; XP ledger trigger + streaks; dashboard progress                              |
| Community | Developer C (TBD) | Events + RSVPs; map with verified locations; announcements; coach view of assigned runners                                 |

## Planning — schedule planner (`feat/schedule-planner`) ✅ merged into `main`

- [x] Availability: manual entry, PDF/PNG/JPG/WebP upload to private bucket (signed URL, byte sniffing, 10 MB), review/correction with explicit per-row confirmation, opt-in "fill gaps"
- [x] Extraction: unpdf text + deterministic parser (no guessing, uncertainties flagged); images and scanned PDFs via AI only
- [x] Deterministic scheduler with recovery rules, explanations, unmet-preference alternatives; independent validator
- [x] Weekly plan UI: edit/add/remove with revalidation, regenerate, reject, approve (409 on duplicate, explicit replace), persisted plans, missed-session rescheduling
- [x] AI: Gemini adapter (server-only, `fetch`, Zod-validated, one attempt + timeout), per-user daily limit, deterministic fallback
- [x] Tests: 90 unit, 18 RLS, 9 API integration (opt-in), e2e desktop + mobile; evaluation in `docs/evaluation/schedule-planner.md`
- [x] Real Gemini call verified with a project key (14 Oct): `gemini-3.1-flash-lite` returns valid JSON. `gemini-2.5-flash` is no longer offered to new keys, so the default is now `gemini-3.8-flash`; it and `gemini-3.5-flash` were returning 503 (high demand) at the time, so set `GEMINI_MODEL=gemini-3.1-flash-lite` if that persists
- [x] `.env.example` lists `GEMINI_API_KEY` / `GEMINI_MODEL`
- [x] Full timetable-image upload through the app with a live Gemini call (14 Oct): all 6 rows of a PNG timetable extracted correctly and returned for review. The call took ~21 s against the 25 s timeout, so slow responses may time out
- [x] Integrated check on `main` (14 Oct): lint, typecheck, 99 unit + API integration tests, 29 RLS tests, build, 38 e2e (desktop + mobile) all pass
- [x] `docs/TECH_DECISIONS.md` updated for the Claude → Gemini switch (LLM and AI SDK rows)
- [ ] Lead sign-off on the Gemini switch and the edits to `src/lib/env.server.ts` and `src/lib/ai/index.ts`
- Env: `AI_PROVIDER` (`gemini`|`none`), `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_DAILY_CALL_LIMIT`; deploy needs migration `20261015090000_planning_scheduler.sql` (creates the `timetables` bucket)

## Runner experience — `feat/runner-experience` ✅ integrated

Details, reward rules and demo instructions: [`docs/RUNNER_EXPERIENCE.md`](docs/RUNNER_EXPERIENCE.md).

- [x] Runner dashboard from persisted data: today's activity, upcoming sessions, weekly progress, habit and weekly streaks, XP, coins, level and rank, character stage, challenges, achievements, goal progress, events, motivational message
- [x] Workout tracking: start → complete (timer), manual entry (last 7 days), history, detail with rewards, plausibility checks, idempotent completion
- [x] Programmes: Couch to 5K (27 sessions, rest days, milestones), five general-fitness programmes, Training and Shine (12 weeks, coach-approval request flow); sequential progress
- [x] Gamification: server-validated XP, coins, levels/ranks, streaks, 16 badges, weekly challenges, 5 character stages, recovery guard; no double rewards
- [x] Reports: week/month/year with charts and empty states
- [x] Community: event RSVPs with capacity, Hyderabad map explorer + list, weekly leaderboard with privacy toggle, share links
- [x] Demo accounts via `POST /api/v1/dev/seed-demo` (labelled, simulated)
- [x] Tests: 49 Vitest (incl. 4 integration on local Supabase), 16 pgTAP, Playwright journey on desktop + mobile

**Setup this branch needs:** run the three new migrations (renamed to `20261015100000`/`100100`/`100200` during integration so they no longer collide with the scheduler's `20261015090000`) (`pnpm db:reset` locally; CI `db push` in production). Set `SUPABASE_SECRET_KEY` on the server, because workouts and rewards cannot be saved without it. Optionally set `DEMO_SEED_TOKEN` to allow demo seeding in production.

**Needs coordination:** the contract additions proposed in `docs/RUNNER_EXPERIENCE.md` (programme `category`/`enrolment`, `challenge_completed` XP reason). Confirm the scheduler's `scheduled_workouts` table/columns, plus a staff policy for approving coach-led enrolments (management area).

## Identity and community — `feat/identity-community` ✅ integrated

Details: [`docs/status/identity-community.md`](docs/status/identity-community.md).

- [x] Onboarding wizard (experience, difficulties, training preferences, places) and profile editing; `user_preferences` table
- [x] Feedback with replies and manager triage, announcements with read state, in-app messages, coach assignments, location updates, role grants (`/community`, `/coach`, `/manager`, `/map`)
- [x] Migration `20261014190000_identity_onboarding_community.sql` with RLS; 49 pgTAP assertions, unit tests, Playwright desktop + mobile

## Integration (`integrate/all-features`)

- `/community` tabs: Leaderboard (runner experience) · Announcements · Feedback · Messages (identity/community). `/map`: the explorer, with published location updates under each place.
- Fresh `pnpm db:reset` applies all six migrations; pgTAP 94/94, Vitest 172 passed (9 opt-in skipped), lint, typecheck, build, Playwright 44/44 (14 Oct 2026, local).
- Still open: the contract additions proposed by both features (see each feature doc), and review of `user_preferences` by the scheduler owner.

## Open decisions

- Team member names for the three owners, plus GitHub usernames for a future `CODEOWNERS` file.
- ~~Exact XP / coin values, level curve and streak rules~~ — proposed in `docs/RUNNER_EXPERIENCE.md` (one rest day keeps a streak; recovery guard after 6 rewarded days in 7).
- Production map tile provider (before real traffic).
- Supabase plan for the demo month (free plans pause after 7 idle days).

## Known limitations

- Cache Components is disabled on purpose (`docs/TECH_DECISIONS.md`).
- Light theme only.
- Coach and mentor visibility of runner profiles waits for `coach_assignments` (Community).
