# Runner experience: fitness, rewards and progress

Branch `feat/runner-experience`. This covers the runner dashboard, workout tracking, programmes, gamification, reports, leaderboard, event RSVPs and the map.

**Journey:** Dashboard → today's planned activity → start → complete → server validates and stores the workout → rewards reconciled → dashboard, programme progress, reports, streaks and leaderboard all recalculate from the stored records.

Every number shown to a runner is derived from persisted rows (`workout_logs`, `xp_ledger`, `user_badges`, `challenge_completions`, `enrollments`, `event_rsvps`). Nothing is hard-coded.

## Where the code lives

| Concern                          | Files                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Reward rules (pure, unit-tested) | `src/features/gamification/logic/` — `rewards.ts`, `streaks.ts`, `levels.ts`, `badges.ts`, `challenges.ts`, `character.ts`, `time.ts`      |
| Reward persistence               | `src/features/gamification/service.ts` (`reconcileRewards`)                                                                                |
| Workout persistence              | `src/features/workouts/service.ts`, `actions.ts`, `logic/validate.ts`                                                                      |
| Programme progress               | `src/features/workouts/logic/programme-progress.ts`, `programme-queries.ts`                                                                |
| Reports                          | `src/features/reports/logic/aggregate.ts`, `queries.ts`                                                                                    |
| Schedule integration (read-only) | `src/features/workouts/planned-source.ts`                                                                                                  |
| Events, RSVPs, map, leaderboard  | `src/features/community/`                                                                                                                  |
| Database                         | `supabase/migrations/20261015100000_training_programmes.sql`, `…100100_training_workouts_rewards.sql`, `…100200_community_event_rsvps.sql` |

## Security model

- Runners **read** their own `workout_logs`, `xp_ledger`, `user_badges`, `challenge_completions`, `enrollments` and `event_rsvps` through RLS.
- Runners **cannot write** workouts, XP, coins or badges. Server actions verify the user with `getClaims()`, validate input, and then write with the secret key (`SUPABASE_SECRET_KEY`). pgTAP tests check that direct inserts are refused.
- Enrolment status is decided by a database trigger. Open programmes start `active`; coach-led programmes start `requested`, and runners cannot approve themselves.
- RSVPs are written by the runner under RLS. A trigger enforces capacity, with the event row locked against races, and refuses moving an RSVP to another event.
- The leaderboard function returns display names and XP only, never ids, emails or locations. It hides runners who opted out, except from themselves.

## Duplicate protection

| Risk                                        | Protection                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Double-clicking "Complete"                  | `completeWorkout` only updates rows still `in_progress`. A second request gets "already completed" and no new rewards. |
| Retried manual entry                        | Client-generated `idempotency_key`, unique per user                                                                    |
| Completing a programme session twice        | Unique index `(enrollment_id, programme_session_id)` where completed                                                   |
| Completing a planned workout twice          | Unique index `(user_id, planned_workout_id)` where completed                                                           |
| Two workouts in progress                    | Unique index on `user_id` where `in_progress`                                                                          |
| Paying a reward twice                       | Every award has a deterministic `award_key`, unique per user, inserted with `ON CONFLICT DO NOTHING`                   |
| Backdating to re-trigger a streak milestone | The engine skips a milestone already paid for any run that overlaps the current one                                    |

Rewards are a pure function of history. `reconcileRewards` can run any number of times; it only inserts what is missing.

## Reward rules

All days are **local calendar days** in the runner's timezone (default `Asia/Kolkata`), never UTC dates. An **active day** has at least one completed workout of 10 minutes or more.

| Rule                                                                                                                   | XP                         | Coins                 | Award key                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------- | ---------------------------------------------------------- |
| First active workout of a local day                                                                                    | 20 + 1 per 5 min (max +12) | 5                     | `workout:day:<date>`                                       |
| Plan bonus: a programme session, or a scheduled workout done on its planned day. Once per day, only on a rewarded day. | 10                         | 2                     | `plan:session:<enrolment>:<session>` / `plan:planned:<id>` |
| Habit streak milestone at 3 / 7 / 14 / 30 / 60 days                                                                    | 15 / 40 / 80 / 150 / 300   | 5 / 10 / 20 / 40 / 80 | `streak:daily:<n>:<run start>`                             |
| Weekly-goal streak at 2 / 4 / 8 / 12 weeks                                                                             | 30 / 60 / 120 / 200        | 10 / 15 / 30 / 50     | `streak:weekly:<n>:<run start week>`                       |
| Badge (see table below)                                                                                                | per badge                  | per badge             | `badge:<code>`                                             |

**Recovery guard:** at most **6 rewarded days in any 7-day window**. A 7th consecutive training day earns no workout XP and no plan bonus, and the dashboard recommends rest. Extra workouts on the same day earn nothing. Short sessions under 10 minutes are stored but do not count. Doubling up programme sessions on one day earns one plan bonus.

**Habit streak:** one rest day between workouts never breaks it, and it counts calendar days including those rest days. Two rest days in a row end it. On the day after a rest day the dashboard shows it as at risk.

**Weekly streak:** consecutive Mon–Sun weeks with at least **3 active days**. The current week never breaks it while it is in progress.

**Levels:** level _n_ starts at 50·_n_·(*n*−1) XP (L2 100, L3 300, L4 600, L5 1000). **Ranks:** Rookie (L1–2), Regular (3–5), Committed (6–9), Dedicated (10–14), Pace setter (15+).

### Badges

| Code                           | Title                                                 | Earned when                                        | XP            | Coins        |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------- | ------------- | ------------ |
| `first-workout`                | First steps                                           | 1st completed workout                              | 20            | 5            |
| `workouts-5` / `-25` / `-50`   | Five and thriving / Twenty-five strong / Half-century | 5 / 25 / 50 workouts                               | 30 / 75 / 150 | 10 / 25 / 50 |
| `streak-7`                     | Week-long habit                                       | 7-day habit streak                                 | 40            | 10           |
| `weekly-streak-4`              | Four steady weeks                                     | 4-week weekly streak                               | 80            | 20           |
| `c25k-week-1`                  | Week 1 done                                           | All week-1 C25K sessions                           | 25            | 5            |
| `c25k-halfway`                 | Halfway there                                         | All week-5 C25K sessions (incl. first 20-min run)  | 60            | 15           |
| `c25k-graduate`                | Couch to 5K graduate                                  | All 27 C25K sessions                               | 200           | 50           |
| `programme-complete`           | Programme finisher                                    | Every session of any programme                     | 100           | 25           |
| `distance-5k` / `distance-42k` | 5 km covered / Marathon in pieces                     | Cumulative run + walk-run distance                 | 25 / 100      | 5 / 25       |
| `all-rounder`                  | All-rounder                                           | Running, strength/conditioning and mobility logged | 40            | 10           |
| `early-bird`                   | Early bird                                            | Active workout started before 07:00 local          | 15            | 5            |
| `challenges-3`                 | Challenge accepted                                    | 3 weekly challenges completed                      | 50            | 15           |
| `community-first-rsvp`         | Joined a group run                                    | First "going" RSVP                                 | 10            | 0            |

### Weekly challenges (reset Monday)

Three-day week (3 active days) · Hour of movement (60 active minutes) · Mix it up (2 activity kinds) · Follow the plan (2 programme or planned sessions). Completions are stored once per week and count towards `challenges-3`. They pay no XP directly, because the shared `XpReason` contract has no challenge reason (see "Proposed contract changes").

### Character evolution

Stages are sequential and unlocked only by earned badges.

| Stage | Name           | Requires                                                            |
| ----- | -------------- | ------------------------------------------------------------------- |
| 1     | Spark          | sign-up                                                             |
| 2     | Stepper        | First steps                                                         |
| 3     | Strider        | Five and thriving **and** Week-long habit                           |
| 4     | Runner         | Halfway there **or** Twenty-five strong                             |
| 5     | Shining runner | (C25K graduate **or** Programme finisher) **and** Four steady weeks |

The avatar gains a visible element per stage: shoes, motion, race bib, medal.

## Programmes

| Category           | Programmes                                                                                           | Notes                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Couch to 5K        | 9 weeks × 3 runs (days 1, 3, 5)                                                                      | Walk/run intervals from the widely used public C25K plan, 5-min warm-up and cool-down, rest days between runs, milestone at the end of each week         |
| General fitness    | Yoga for runners, Upper-body basics, Mobility basics, Strength and conditioning, Recovery essentials | 2–6 weeks, beginner/intermediate                                                                                                                         |
| Training and Shine | 12 weeks × 4 (easy, intervals, strength, long run)                                                   | Advanced and coach-led. Enrolment is a **request** (`enrolment = 'coach_approval'`) that a coach approves; ready for paid places later, free for the POC |

Progression is sequential. The next session is the first one not completed. After a session today or yesterday, the app recommends a rest day; starting anyway is allowed, but the recovery guard limits the rewards.

Content is product data seeded in the migration. It is general fitness guidance, not medical advice.

## Integration with the schedule planner

`planned-source.ts` reads approved planned workouts from **`scheduled_workouts`** and maps them to the shared `PlannedWorkout` contract. Columns are assumed to be the snake_case form of the contract fields. Until the scheduler migration exists, the query returns an empty list and the dashboard falls back to programme sessions. This branch never generates or edits schedules. A planned workout counts as completed when a completed `workout_logs` row references it; we do not write to the scheduler's table. `workout_logs.planned_workout_id` has no foreign key yet, to be added once `scheduled_workouts` lands.

## Reports

These are personal reports for week, month and year (Mon–Sun weeks; local dates). They cover workout count, active time, run and walk-run distance, active days and consistency %, planned vs completed, activity mix, a habit-streak line and badges earned in the period. "Planned" uses scheduled workouts when the planner provides them, otherwise active programmes' weekly session targets, and the page labels which one it used. Empty periods show an empty state.

## Community, map and sharing

- **Events:** published events from the shared `events` table, with going counts (`event_attendance()`), "I'm going" / cancel, capacity, and a filter by location (`/events?location=…`).
- **Map:** Leaflet centred on Hyderabad. You can pan anywhere, filter by place type, and "Show on map" flies to a place; a list version sits below the map. Only public places are shown, and red pins have upcoming events. Seeded places are labelled **Unverified sample**.
- **Leaderboard:** weekly XP (local Mon–Sun) on `/community`, with a "Hide me" privacy toggle stored in `runner_settings`.
- **Sharing:** WhatsApp, X, the native share sheet or copy-text, sharing a short message plus the site URL. No profile, location or workout id is exposed.

## Demo data

`POST /api/v1/dev/seed-demo` creates or resets labelled demo accounts through the real services, with `source = 'simulated'`:

| Account                                                            | Password           | Content                                                                                                                         |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `demo.runner@hydrunners.test` ("Demo Runner (sample)")             | `hyd-runners-demo` | Seven C25K sessions every other day ending two days ago, one yoga and one strength session, an RSVP to the first upcoming event |
| `sample.lakshmi@…`, `sample.rahul@…`, `sample.fatima@…` "(sample)" | `hyd-runners-demo` | A few simulated runs this week, for the leaderboard                                                                             |

```bash
pnpm db:start && pnpm dev
curl -X POST http://localhost:3000/api/v1/dev/seed-demo
```

The endpoint always works in development. In production it is disabled unless `DEMO_SEED_TOKEN` is set, in which case it needs `Authorization: Bearer <token>`. It only ever modifies accounts flagged `user_metadata.demo = true`. Demo accounts show a "Demo account" note, and simulated workouts carry a "Simulated" badge.

## Tests

| Layer       | File                                                 | Covers                                                                                                                                                                     |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `tests/unit/runner/rewards.test.ts`                  | XP formula, daily cap, idempotent keys, backdating guard, recovery guard, plan bonus, C25K badges, challenges, distance badges, levels, character                          |
| Unit        | `tests/unit/runner/time-and-streaks.test.ts`         | IST day boundaries (incl. 00:30 IST = previous UTC day), rest-day streak rules, weekly streaks, series                                                                     |
| Unit        | `tests/unit/runner/progress-and-reports.test.ts`     | Programme progress and rest days, plausibility checks, week/month/year aggregation, empty reports, motivation                                                              |
| Integration | `tests/unit/runner/services.integration.test.ts`     | Real services on local Supabase: concurrent duplicate completion, re-reconcile pays nothing, session completed once, idempotent manual entry. Skipped without `.env.local` |
| Database    | `supabase/tests/database/runner_experience.test.sql` | RLS on new tables, no self-awarded XP or badges, enrolment trigger, leaderboard privacy and ranking, RSVP capacity and attendance                                          |
| E2E         | `tests/e2e/runner-journey.spec.ts`                   | Sign up → empty states → enrol → start → double-submit completion → one workout, rewards → dashboard, programme, leaderboard, privacy toggle, RSVP/cancel                  |

## Proposed contract changes (not applied, need the lead)

1. `TrainingProgramme`: add `category: "couch_to_5k" | "general_fitness" | "training_and_shine"` and `enrolment: "open" | "coach_approval"`. These are stored in the database and returned alongside the contract today.
2. `XpReason`: add `challenge_completed` so weekly challenges can pay XP directly.
3. `PlannedWorkout`: confirm the table name `scheduled_workouts` and its column names with the scheduler owner, and add the foreign key from `workout_logs.planned_workout_id`.

## Limitations

- The web POC uses manual entry and a simple elapsed timer. There is no GPS or background tracking; demo history is labelled as simulated.
- Rewards are recomputed from full history on each completion. That is fine for POC volumes (thousands of workouts); a high-volume version would make it incremental.
- The weekly goal is a fixed 3 active days, until user preferences exist.
- Coach approval of Training and Shine requests is not built here. It belongs to the management area and needs a staff update policy on `enrollments` (or a secret-key server action); the trigger already allows staff to move `requested` → `active`.
- Announcements and feedback tabs remain placeholders, owned by another area.
- Share links point to the site home page; there are no public per-achievement pages yet.
