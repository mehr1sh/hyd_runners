# Local demo data

A seed for local development that fills the app with one coherent, fictional Hyderabad running community, so every page has something to show. It is **local only**.

```bash
pnpm db:start        # the local Supabase stack
pnpm demo:seed       # create or top up the demo community (prints the sign-in details)
pnpm demo:check      # consistency checks; prints row counts
pnpm demo:reset      # remove every demo account and everything they created
```

`pnpm demo:seed` prints three accounts and a password. The password is shared by every demo account and is new on each run.

| Account                        | Use it for                                                             |
| ------------------------------ | ---------------------------------------------------------------------- |
| `meera@demo.hydrunners.test`   | A runner with eight weeks of history, a coach and a half-marathon plan |
| `sandeep@demo.hydrunners.test` | The coach dashboard (four assigned runners)                            |
| `team@demo.hydrunners.test`    | Programme manager and admin pages, including the verification queue    |

Seeding twice adds nothing. Dates are relative to the day of the first seed, so after a few weeks the data looks old: run `pnpm demo:reset && pnpm demo:seed` to refresh it. For a clean local database (no leftovers from e2e runs) run `pnpm db:reset` first.

## How production and Preview are protected

Vercel Production and Preview share the production Supabase project, so demo data must never be written there. Several independent safeguards keep it out:

- **The runner only talks to the local stack.** `scripts/demo-data/run.mjs` takes its URLs and keys from `supabase status` (the local stack), never from `.env*` files. It refuses to run when the API or database URL is not a loopback address, when `NEXT_PUBLIC_SUPABASE_URL` in the shell points anywhere else, on Vercel, or with `NODE_ENV=production`. SQL runs with `docker exec` into the local database container, and the runner never uses `--linked`.
- **It is not a migration.** The SQL lives in `scripts/demo-data/`, not `supabase/migrations/`, and is not in `supabase/config.toml`'s `sql_paths`, so `supabase db push`, the gated deploy workflows and `supabase db reset` never run it.
- **The app never imports it.** Nothing under `src/` refers to the seed or the demo domain.
- **Tests pin all of this** (`tests/unit/demo-data.test.ts`). CI seeds twice and resets against its own throwaway local stack after the e2e suite.

Preview deployments have no Supabase configuration, so they show the app in preview mode with no data. A populated Preview would need its own separate Supabase project. That is an owner decision with possible cost, and it has not been set up.

## What makes the data honest

- **Fictional, labelled people.** All 22 people are fictional. Display names end in "(sample)" and emails use the reserved `.test` domain. Each account carries `app_metadata.demo = true`, which only the service role can set.
- **Shared objects say so.** Clubs, squads, leagues and challenges are named "(sample)", events start with "Sample:", and descriptions say they are sample content.
- **Professionals are never verified.** The five sample professionals stay "Not verified" or "Verification pending", claim no credentials, have no bookable slots and no bookings. The bookable directory is unchanged. They appear only in a separate "Sample profiles" section of Coaches and physios, which reads `sample_professionals()`. That function returns only accounts flagged as demo in app metadata, so it is empty in production.
- **No payments and no AI conversations.** There are no payments or transactions. HYD Coach shows its own suggested prompts, and no conversations are invented.
- **GPS runs follow real routes.** They follow the two OpenStreetMap routes already in the database (KBR Park Nature Trail and Bachupally Jogging Track). Each GPX file says it is sample data, and files carry no elevation or heart rate. They go through the app's own import pipeline, so splits, best efforts, workouts, XP, badges, league points and challenge progress are all computed by the app, never typed in. Group runs, Couch to 5K sessions and walks are logged through the workout service with `source = "simulated"`.

## How it is built

1. **Accounts:** created through the GoTrue admin API with fixed ids (`de000000-0000-4000-8000-0000000000NN`). The runner refuses to touch any existing account that is not flagged as demo.
2. **`community.sql`:** profiles, clubs and members, four weekly group-run series (four weeks of past runs with check-ins, the next four scheduled by `schedule_series_runs`), one-off events with pace groups and event teams, squads, leagues, challenges, follows, partner matching, professionals, coaching, races, recovery and strength logs. Rows a person writes are inserted with that person's JWT claims, so every guard trigger, constraint and foreign key applies as in the app.
3. **GPS activities and workouts:** created by `seed.ts`.
4. **Rewards:** XP, badges and challenge settlement through `reconcileRewards`.
5. **`social.sql`:** kudos and comments from followers, a race story, time-trial results taken from each runner's own GPS time, race-passport entries backed by those activities, and coach notes.
6. **Race plan:** Meera's half-marathon plan is built by the same code as the Training page's "Generate plan" (`buildRacePlanProposal`) and accepted through `decide_training_proposal`, signed in as her.

`demo:reset` deletes demo-id objects and the demo accounts; their rows cascade. Audit-log entries stay, because the log is append-only.

## Page coverage

| Area                                                   | Populated by                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Today (dashboard)                                      | Workouts, activities, XP, badges, challenges, plan sessions, events                  |
| Community leaderboard, announcements, messages         | XP this week, programme announcements, coach messages                                |
| Clubs, club pages, club pass                           | 4 clubs with members, announcements, upcoming runs, weekly XP leaderboards           |
| Group runs, run pages, radar                           | 4 weekly series, past check-ins, upcoming runs with RSVPs                            |
| Events, event pages, manage, check-in, captains        | Time trial with results, half marathon with pace groups and team, workshop, socials  |
| Challenges and leaderboards                            | 5 city and club challenges; progress from workouts and check-ins                     |
| Leagues and standings                                  | Club league (3 club teams) and a consistency league                                  |
| Feed, runners, runner profiles                         | Follows, shared activities, kudos, comments, showcases                               |
| Squads and squad pages                                 | 3 squads, chat, squad run, relay, weekly targets                                     |
| Find partners                                          | 14 opted-in matching profiles                                                        |
| Coaches and physios                                    | Sample profiles section (5, never verified)                                          |
| Activities, Performance Lab, Wrapped, route collection | 143 GPS activities                                                                   |
| Workouts, reports, train                               | 250 workouts                                                                         |
| Training, schedule                                     | Race goal, accepted plan, coach notes, availability                                  |
| Race Passport                                          | Planned half marathon (with checklist), completed 10K backed by an activity, past 5K |
| Recovery, strength                                     | Three weeks of recovery entries, strength logs                                       |
| Coach dashboard, runner overview                       | 4 assigned runners, notes, replies, shared recovery                                  |
| Manager, professional verification                     | Announcements, place update, two pending verifications                               |
| Routes and route pages                                 | Reviews and a condition report on the two real routes                                |

Bookings stay empty on purpose: the seed never creates bookings.
