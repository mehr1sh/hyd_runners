# Implementation roadmap

HYD Runners aims to be the operating system for running in a city: a place where people discover running, find their community, train intelligently, take part in events and build a lasting habit.

This file records what has actually shipped. A feature is marked done only when it works end to end. A migration is marked applied only after its production dry run, apply and schema verification.

**Status values:** Not started · In progress · Implemented locally · PR opened · CI passing · Merged · Deployed · Production verified · Blocked by external dependency.

## Release 0: foundation and security

Production verified. Details are in [release-0-progress.md](release-0-progress.md).

## Release 1: the core city-running experience

Release 1 is sequenced in this order:

1. **Events v2** builds on the existing events, RSVPs and sample events, and lays the organiser-permission foundation.
2. **Clubs** reuse the organiser-scoped permission model.
3. **Group runs and pace pods** need clubs and events.
4. **Routes v1** need PostGIS. Events and group runs then link to routes.
5. **Navigation** is redesigned last, once the Explore, Community and Events pages exist.

| Workstream                              | Status                                   | PR            | Migration                   | Notes                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------- | ------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Events v2                            | Production verified (schema), 2026-11-08 | #15 `3e80c77` | `20261110120000_events_v2`  | Event teams, waiting lists, check-in, pace groups, announcements, private results, calendar export, past events. Route maps come with Routes v1. Dry run 42501025649, apply 42501096425, verify 42501161486                                                                                                                                   |
| B. Clubs                                | Production verified (schema), 2026-11-08 | #16 `2443506` | `20261111120000_clubs`      | Club-scoped roles, join requests, invite links, announcements, club runs, stats and a members-only leaderboard. Managers create clubs. Dry run 42503061059, apply 42503121609, verify 42503216535                                                                                                                                             |
| C. Group runs and pace pods             | Production verified (schema), 2026-11-08 | #17 `61cff45` | `20261112120000_group_runs` | Recurring series scheduled into events with default pace groups, no-drop and regroup policies, turnout and personal run history. Dry run 42504958021, apply 42505019352, verify 42505078833                                                                                                                                                   |
| D. Routes v1 and Hyderabad Run Explorer | Production verified (schema), 2026-11-08 | #18 `0720666` | `20261113120000_routes`     | PostGIS routes with database-computed distance and loops, provenance and manager-only verification, GPX uploads (real elevation only), reviews, expiring condition reports, event and series links, event route maps. Two curated OpenStreetMap traces (attributed, not verified). Dry run 42507576402, apply 42507633827, verify 42507688292 |
| E. Navigation redesign                  | Deployed, 2026-11-08                     | #19 `b37e330` | none                        | Six sections with section tabs and Train/Explore hubs; all existing URLs kept; new routes confirmed live behind sign-in                                                                                                                                                                                                                       |

## Release 2: activity intelligence and engagement

| Workstream                        | Status                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. GPX/FIT import                 | Production verified (schema), 2026-11-09                | #20 `e583342`, `20261114120000_activities`. Activities with owner-only tracks, privacy-trimmed shared routes, service-only metrics, duplicate detection, manual-log reconciliation; see [activities.md](activities.md). FIT parsing with `fit-file-parser` (MIT). Dry run 42599876324, apply 42599965905, verify 42600057941                                                                                                             |
| B. Performance Lab v1             | Production verified (schema), 2026-11-09                | #21 `ccbf662`, `20261115120000_performance_lab`. Database aggregates for summaries, weekly trends, GPS best efforts (kept apart from official results), pace by distance, inferred training mix, same-route matching, year report; pacing analysis and Running DNA with stated evidence. See [performance-lab.md](performance-lab.md). Dry run 42601543540, apply 42601628308, verify 42601716923                                        |
| C. Weather and running conditions | Deployed, 2026-11-09 (AQI awaiting a provider decision) | #25. Run now or later from MET Norway (no account, commercial use permitted, attributed, Expires honoured); explained hourly scores for heat, humidity, rain, wind, UV and daylight; labelled sample provider for tests. AQI: no free no-account commercial source exists, so it is not configured and never estimated. See [run-conditions.md](run-conditions.md)                                                                       |
| D. Challenges v2                  | Production verified (schema), 2026-11-09                | #22 `8a566a4`, `20261116120000_challenges_v2`. City-wide and club challenges (distance, active days, activities, early runs, group runs, events, places, longest run; individual or group goals) on the existing XP ledger, paid once via `challenge:<id>`; anti-gaming rules; see [challenges.md](challenges.md). Dry run 42602919001, apply 42603082987, verify 42603204628                                                            |
| E. Share cards                    | Deployed, 2026-11-09                                    | #24. Owner-only PNG cards (square, story, wide) for activities and completed challenges via `next/og`; privacy-trimmed route only, date without time, optional hidden route and pace; see [share-cards.md](share-cards.md)                                                                                                                                                                                                               |
| F. Dashboard redesign             | Deployed, 2026-11-09                                    | #26. Today and run-now-or-later first, then progress, last 7 days of imports, recent activities and live challenges; independent panels with honest empty and unavailable states; see [dashboard.md](dashboard.md)                                                                                                                                                                                                                       |
| G. Route search                   | Production verified (schema), 2026-11-09                | #23 `64280cd`, `20261117120000_route_search`. Dry run 42604561978, apply 42604658715, verify 42604795326. Typed `search_routes()` (caller's rights, validated parameters) with text, near-a-place radius, distance, attributes, facilities, rating, open-report and sort filters; deterministic plain-English parser that only fills whitelisted filters, no SQL generation, no external service. See [route-search.md](route-search.md) |
| H. Social v1                      | Production verified (schema), 2026-11-09                | #27 `25434f6`, `20261118120000_social_v1`. Dry run 42608017296, apply 42608115992, verify 42608219451. Follows with approval by default, followers-only visibility, blocks both ways, kudos, comments, feed, minimal runner profiles and opt-out search, reports and moderator hiding through the existing workflow; see [social.md](social.md)                                                                                          |

## Release 3: final product release

Release 3 completes the product. It follows the original Release 3 and 4 plan and builds on what Release 2 shipped (reconciled against `main` at `62fc980` on 2026-11-09: all eight Release 2 workstreams merged, five migrations applied with no drift). It is built in dependency order, one PR per workstream.

**Verification labels:**

- **Production verified:** deployed, and the production behaviour was checked.
- **CI/local verified:** automated tests passed in CI and locally.
- **Staging only:** nothing yet; there is no separate staging project.
- **Externally configured:** waiting for an owner account, credentials or approval.
- **Unverified:** not tested.

Signed-in production flows are not tested, because that would need production test accounts.

| Workstream                                | Status      | Notes                                                                                           |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| A. HYD Coach                              | In progress | Answers come from the runner's own data; AI may only rephrase; see [hyd-coach.md](hyd-coach.md) |
| B. Adaptive training and race preparation | Not started | Reuses the planner's approval flow                                                              |
| C. Recovery and strength                  | Not started | Makes no medical claims                                                                         |
| D. Human coach platform                   | Not started | Builds on Release 0 assignment rules                                                            |
| E. Runner matching and squads             | Not started |                                                                                                 |
| F. Advanced group runs and live tracking  | Not started | Location sharing is opt-in and time-limited                                                     |
| G. Leagues                                | Not started |                                                                                                 |
| H. Race Passport                          | Not started |                                                                                                 |
| I. Wearable and health integrations       | Not started | Strava needs API approval; Health Connect and HealthKit need the native app                     |
| J. Native mobile companion                | Not started | Store release needs owner developer accounts                                                    |
| K. Coach and physiotherapist marketplace  | Not started | Real payments stay disabled                                                                     |
| L. Visual and storytelling features       | Not started |                                                                                                 |
| M. Experimental running experiences       | Not started |                                                                                                 |
| N. Final integration and QA               | Not started |                                                                                                 |

## Dependency register

| Dependency                        | Needed for                               | Status                                                                        | Production configuration                                                                                                                  |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SMTP provider                     | Password reset, invites, reminders       | Owner action                                                                  | Supabase → Authentication → SMTP settings                                                                                                 |
| Weather provider                  | Release 2 C, Release 3 A and B           | MET Norway, in use (no account, commercial use allowed, attributed)           | `CONDITIONS_PROVIDER` (default `met_norway`; `sample` for tests)                                                                          |
| Air-quality provider              | Release 2 C                              | Owner decision: no free, account-free source allows commercial use            | Options and licences in [run-conditions.md](run-conditions.md)                                                                            |
| Map tiles                         | All maps                                 | OpenStreetMap tile servers, under OSMF policy                                 | `NEXT_PUBLIC_MAP_TILE_URL`. Heavier use needs a commercial tile provider                                                                  |
| Elevation data                    | Routes                                   | Not needed: elevation comes only from uploaded GPX/FIT files, never estimated | none                                                                                                                                      |
| AI provider                       | Release 3 A (optional phrasing), planner | Gemini adapter exists; every AI feature works without it                      | `AI_PROVIDER`, `GEMINI_API_KEY`, `AI_DAILY_CALL_LIMIT` (server-only). Whether Production has a key set is not visible from the repository |
| Strava API                        | Release 3 I                              | Needs API approval                                                            |                                                                                                                                           |
| Health Connect and HealthKit      | Release 3 I                              | Needs a native app                                                            |                                                                                                                                           |
| Payment provider                  | Release 3 H and K                        | Needs separate review                                                         |                                                                                                                                           |
| Vercel Preview Supabase variables | Signed-in preview testing                | Owner action                                                                  | Preview: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                                               |

## UX debt

- Several older forms wrap a `<select>` inside its `<label>`, which adds the option text to the control's accessible name. The group-run form uses explicit `id`/`htmlFor`; migrate the rest.
