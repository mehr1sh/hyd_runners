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

| Workstream                        | Status      | Notes                                                                                                                                                                                                                                                                                |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. GPX/FIT import                 | PR opened   | Activities with owner-only tracks, privacy-trimmed shared routes, service-only metrics, duplicate detection, manual-log reconciliation; see [activities.md](activities.md). FIT parsing with `fit-file-parser` (MIT)                                                                 |
| B. Performance Lab v1             | PR opened   | Database aggregates for summaries, weekly trends, GPS best efforts (kept apart from official results), pace by distance, inferred training mix, same-route matching, year report; pacing analysis and Running DNA with stated evidence. See [performance-lab.md](performance-lab.md) |
| C. Weather and running conditions | Not started | Provider licensing must be decided first; see the register below                                                                                                                                                                                                                     |
| D. Challenges v2                  | Not started | Must keep the current XP and award idempotency                                                                                                                                                                                                                                       |
| E. Share cards                    | Not started |                                                                                                                                                                                                                                                                                      |
| F. Dashboard redesign             | Not started |                                                                                                                                                                                                                                                                                      |
| G. Route search                   | Not started | Needs Release 1 D                                                                                                                                                                                                                                                                    |
| H. Social v1                      | Not started | Reuses Release 0 moderation                                                                                                                                                                                                                                                          |

## Release 3: HYD Coach

| Workstream             | Status      | Notes                                     |
| ---------------------- | ----------- | ----------------------------------------- |
| A. Coach Q&A           | Not started | Answers must come from database summaries |
| B. Adaptive training   | Not started | Reuses the planner's approval flow        |
| C. Race and pace tools | Not started | Predictions are labelled as estimates     |
| D. Recovery journal    | Not started | Makes no medical claims                   |
| E. Human coach tools   | Not started | Builds on Release 0 access rules          |

## Release 4: the wider running ecosystem

| Workstream                               | Status                         | Notes                                                                             |
| ---------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| A. Runner matching and squads            | Not started                    |                                                                                   |
| B. Live group runs                       | Not started                    | Location sharing is opt-in and time-limited; reliable tracking needs a native app |
| C. Leagues                               | Not started                    |                                                                                   |
| D. Race Passport                         | Not started                    |                                                                                   |
| E. Event management platform             | Not started                    | Payments are not enabled without separate authorisation                           |
| F. Health and wearable integration       | Blocked by external dependency | Needs a native app and Strava API approval                                        |
| G. Coach and physiotherapist marketplace | Not started                    | Architecture only; transactions need separate approval                            |

## Dependency register

| Dependency                        | Needed for                         | Status                                        | Production configuration                                                    |
| --------------------------------- | ---------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| SMTP provider                     | Password reset, invites, reminders | Owner action                                  | Supabase → Authentication → SMTP settings                                   |
| Weather and AQI provider          | Release 2 C                        | Research pending                              | Server-only API key; variable name to be decided                            |
| Map tiles                         | All maps                           | OpenStreetMap tile servers, under OSMF policy | `NEXT_PUBLIC_MAP_TILE_URL`. Heavier use needs a commercial tile provider    |
| Elevation data                    | Routes                             | Research pending                              |                                                                             |
| AI provider                       | Release 3                          | Gemini adapter exists                         | `AI_PROVIDER`, `GEMINI_API_KEY` (server-only)                               |
| Strava API                        | Release 4 F                        | Needs API approval                            |                                                                             |
| Health Connect and HealthKit      | Release 4 F                        | Needs a native app                            |                                                                             |
| Payment provider                  | Release 4 E and G                  | Needs separate review                         |                                                                             |
| Vercel Preview Supabase variables | Signed-in preview testing          | Owner action                                  | Preview: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

## UX debt

- Several older forms wrap a `<select>` inside its `<label>`, which adds the option text to the control's accessible name. The group-run form uses explicit `id`/`htmlFor`; migrate the rest.
