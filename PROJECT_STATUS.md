# Project status

_Last updated: 14 Oct 2026 · Phase 0 (foundation) complete locally; not yet pushed to GitHub._

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
- [ ] Push to GitHub `main` (waiting for the repository URL)
- [ ] Create Vercel + Supabase cloud projects and set env vars (`DEPLOYMENT.md`)
- [ ] Create `feature/planning`, `feature/training`, `feature/community` from `main`

## Phase 1 — First proof of concept (parallel)

Gate: a new runner can upload a timetable, confirm it, see a week of C25K sessions in free slots, log one and earn XP.

| Area      | Owner             | First milestone                                                                                                            |
| --------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Planning  | Developer A (TBD) | Onboarding + preferences; timetable upload → extraction (AI + fallback) → review → availability; scheduler places sessions |
| Training  | Developer B (TBD) | C25K programme data + enrolment; log workout; XP ledger trigger + streaks; dashboard progress                              |
| Community | Developer C (TBD) | Events + RSVPs; map with verified locations; announcements; coach view of assigned runners                                 |

## Open decisions

- Team member names for the three owners, plus GitHub usernames for a future `CODEOWNERS` file.
- Exact XP / coin values, level curve and streak rules (do rest days count?).
- Production map tile provider (before real traffic).
- Supabase plan for the demo month (free plans pause after 7 idle days).

## Known limitations

- Cache Components is disabled on purpose (`docs/TECH_DECISIONS.md`).
- Light theme only.
- Coach and mentor visibility of runner profiles waits for `coach_assignments` (Community).
