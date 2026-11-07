# Status: identity onboarding + community management

_Branch `feat/identity-community` · last verified 14 Oct 2026 · not yet committed, pushed or opened as a PR._

## What this branch adds

**Identity (onboarding and profile)**

- `/onboarding`: a three-step wizard (experience → training → places) that resumes where the runner stopped.
  - Experience: display name, running experience, difficulties (consistency, a changing timetable, or both → `primary_need`), and timezone (validated as an IANA name).
  - Training: goal, preferred activities, days, times of day, sessions per week, typical session length.
  - Places: preferred locations (unverified ones are labelled) and in-app notification preferences. Finishing sets `profiles.onboarded_at`.
- `/profile`: shows roles (read-only) and saved answers, and edits name, timezone, experience and difficulties.

**Community**

- `/community` (runner): announcements with unread state and "Mark as read"; participation feedback (barrier, details, optional rating) with replies; in-app messages to the runner's coach and to managers.
- `/coach` (coach, mentor, manager, admin): feedback assigned to them, with replies (a staff reply moves `new` → `acknowledged`); messages.
- `/manager` (programme manager, admin): announcements (incl. scheduled), events, locations and location updates, feedback triage (assign and set status), coach/mentor role grants, coach ↔ runner assignments, and messages.
- `/map`: shows published location updates under each location.
- Nothing sends email or push. Messages and reminders stay in the app.

**Database**: migration `supabase/migrations/20261014190000_identity_onboarding_community.sql`

| Table                                 | Purpose                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| `user_preferences`                    | Scheduling preferences (mirrors `UserPreferences`, plus extensions) |
| `coach_assignments`                   | Coach/mentor → runner links that gate staff visibility              |
| `feedback`, `feedback_replies`        | Participation feedback and threaded replies                         |
| `announcements`, `announcement_reads` | Announcements and per-user read state                               |
| `location_updates`                    | Notices attached to existing `locations`                            |
| `messages`                            | Append-only in-app notes                                            |

Every table has RLS and column-level grants. Triggers stop non-staff from being assigned as coaches or feedback owners.

## Verification (14 Oct 2026, local)

| Check                                              | Result                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm lint`                                        | pass                                                                                          |
| `pnpm typecheck`                                   | pass                                                                                          |
| `pnpm test` (Vitest)                               | 53 passed                                                                                     |
| `pnpm db:reset && pnpm db:test` (pgTAP)            | 60 passed (11 foundation + 49 identity/community); also passes on a DB with leftover e2e data |
| `pnpm build`                                       | pass                                                                                          |
| `pnpm test:e2e` (desktop + mobile, local Supabase) | 40 passed, incl. 4 new in `tests/e2e/identity-community.spec.ts`                              |

New E2E coverage:

1. A new runner signs up, completes all three onboarding steps, edits the profile, sees the finished state on `/onboarding`, and submits feedback.
2. A runner submits feedback. A manager publishes an announcement, assigns a coach, and assigns the feedback. The coach sees it with the runner's name and replies, which acknowledges it. The runner marks the announcement read and sees the reply. It also checks that runners are blocked from `/coach`, that all six manager tabs are reachable on a phone, and that no page scrolls horizontally.

## Defects found and fixed while finishing

- **Onboarding training step always failed.** `saveTraining` used a PostgREST upsert, which emits `ON CONFLICT DO UPDATE SET user_id = …`. `authenticated` has no UPDATE grant on `user_id`, so Postgres rejected even the first save. It now does an explicit insert or update, and pgTAP asserts that `user_id` cannot be updated.
- **Coaches could never see their assigned runners' profiles.** In the policy `profiles: coaches read assigned`, the bare `id` inside the `coach_assignments` subquery resolved to `ca.id`. It is now qualified as `profiles.id`, with pgTAP and E2E coverage.
- **Timezone accepted any text.** It is now validated as an IANA name in the form parser and the training action, so the future scheduler never receives an invalid zone.
- **Manager tabs were clipped on phones.** The sixth tab (Messages) could not be reached. The tab row now scrolls horizontally (page-level wrapper; the shared `Tabs` component is unchanged).
- pgTAP counts were scoped to the test's own fixture rows, so `db:test` also passes after local e2e runs.
- Prettier formatting was applied to this branch's files only.

## Needs the lead / other owners

- **Contract extensions (label `contracts`).** These are stored in the DB and typed inside the feature, but not yet in `src/lib/contracts`: `user_preferences.preferred_activities`, `preferred_location_ids`, `notify_in_app`; `feedback.barrier` and `assigned_to`; `feedback_replies`, `announcement_reads`, `location_updates`, `messages`. Column comments in the migration mark each one.
- **Ownership.** `user_preferences` belongs to Planning in `CONTRIBUTING.md`. The scheduler owner should review its shape before it is merged.
- **Branch naming.** `CONTRIBUTING.md` expects `feature/<area>` or `<area>/<topic>` branches. This work is on `feat/identity-community` and spans Planning and Community, so the lead should decide how it is split or merged.
- `PROJECT_STATUS.md` is not updated here. Update it when this branch merges.

## Known limitations

- Runners can read only their own profile, so a staff member's name shows as "Member" on replies and messages a runner receives. The recipient picker shows real names because it uses a security-definer RPC. A narrow "read names of my coach / of message participants" policy or RPC would fix this.
- Feedback cannot be un-assigned from the UI ("Unassigned" is ignored by the update action).
- Programme-scoped announcements are visible to staff only until enrolments exist (Training).
- Managers and admins can read all messages. This is intentional for safeguarding, but the team should confirm it.
- E2E tests create accounts in the local DB and do not delete them (same as `auth-flow.spec.ts`).

## Local notes

- Use the pinned pnpm 11.5.2 (`corepack enable`, or `npx pnpm@11.5.2 <script>`). pnpm 9 fails on this repo's `pnpm-workspace.yaml` with "packages field missing or empty".
- If port 3000 is busy, run `pnpm start --port 3100` and `PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm test:e2e`.
