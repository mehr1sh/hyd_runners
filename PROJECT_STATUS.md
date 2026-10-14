# Project status

_Last updated: 14 Oct 2026 · Foundation on `main`; runner experience in review on `feat/runner-experience`._

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
- [x] Push to GitHub `main`
- [ ] Create Vercel + Supabase cloud projects and set env vars (`DEPLOYMENT.md`)
- [ ] Create `feature/planning`, `feature/training`, `feature/community` from `main`

## Phase 1 — First proof of concept (parallel)

Gate: a new runner can upload a timetable, confirm it, see a week of C25K sessions in free slots, log one and earn XP.

| Area      | Owner             | First milestone                                                                                                            |
| --------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Planning  | Developer A (TBD) | Onboarding + preferences; timetable upload → extraction (AI + fallback) → review → availability; scheduler places sessions |
| Training  | Developer B (TBD) | C25K programme data + enrolment; log workout; XP ledger trigger + streaks; dashboard progress                              |
| Community | Developer C (TBD) | Events + RSVPs; map with verified locations; announcements; coach view of assigned runners                                 |

## Runner experience — `feat/runner-experience` (in review)

Details, reward rules and demo instructions: [`docs/RUNNER_EXPERIENCE.md`](docs/RUNNER_EXPERIENCE.md).

- [x] Runner dashboard from persisted data: today's activity, upcoming sessions, weekly progress, habit and weekly streaks, XP, coins, level and rank, character stage, challenges, achievements, goal progress, events, motivational message
- [x] Workout tracking: start → complete (timer), manual entry (last 7 days), history, detail with rewards, plausibility checks, idempotent completion
- [x] Programmes: Couch to 5K (27 sessions, rest days, milestones), five general-fitness programmes, Training and Shine (12 weeks, coach-approval request flow); sequential progress
- [x] Gamification: server-validated XP, coins, levels/ranks, streaks, 16 badges, weekly challenges, 5 character stages, recovery guard; no double rewards
- [x] Reports: week/month/year with charts and empty states
- [x] Community: event RSVPs with capacity, Hyderabad map explorer + list, weekly leaderboard with privacy toggle, share links
- [x] Demo accounts via `POST /api/v1/dev/seed-demo` (labelled, simulated)
- [x] Tests: 49 Vitest (incl. 4 integration on local Supabase), 16 pgTAP, Playwright journey on desktop + mobile

**Setup this branch needs:** run the three new migrations (`pnpm db:reset` locally; CI `db push` in production). Set `SUPABASE_SECRET_KEY` on the server, because workouts and rewards cannot be saved without it. Optionally set `DEMO_SEED_TOKEN` to allow demo seeding in production.

**Needs coordination:** the contract additions proposed in `docs/RUNNER_EXPERIENCE.md` (programme `category`/`enrolment`, `challenge_completed` XP reason). Confirm the scheduler's `scheduled_workouts` table/columns, plus a staff policy for approving coach-led enrolments (management area).

## Open decisions

- Team member names for the three owners, plus GitHub usernames for a future `CODEOWNERS` file.
- ~~Exact XP / coin values, level curve and streak rules~~ — proposed in `docs/RUNNER_EXPERIENCE.md` (one rest day keeps a streak; recovery guard after 6 rewarded days in 7).
- Production map tile provider (before real traffic).
- Supabase plan for the demo month (free plans pause after 7 idle days).

## Known limitations

- Cache Components is disabled on purpose (`docs/TECH_DECISIONS.md`).
- Light theme only.
- Coach and mentor visibility of runner profiles waits for `coach_assignments` (Community).
