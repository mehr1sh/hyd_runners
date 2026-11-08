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

| Workstream                              | Status      | PR  | Migration | Notes                                                                   |
| --------------------------------------- | ----------- | --- | --------- | ----------------------------------------------------------------------- |
| A. Events v2                            | Not started |     |           |                                                                         |
| B. Clubs                                | Not started |     |           |                                                                         |
| C. Group runs and pace pods             | Not started |     |           |                                                                         |
| D. Routes v1 and Hyderabad Run Explorer | Not started |     |           | Routes come only from verified GPX uploads or traced OpenStreetMap ways |
| E. Navigation redesign                  | Not started |     |           | Today, Train, Explore, Community, Events, Profile                       |

## Release 2: activity intelligence and engagement

| Workstream                        | Status      | Notes                                                            |
| --------------------------------- | ----------- | ---------------------------------------------------------------- |
| A. GPX/FIT import                 | Not started |                                                                  |
| B. Performance Lab v1             | Not started | Needs A for splits and elevation                                 |
| C. Weather and running conditions | Not started | Provider licensing must be decided first; see the register below |
| D. Challenges v2                  | Not started | Must keep the current XP and award idempotency                   |
| E. Share cards                    | Not started |                                                                  |
| F. Dashboard redesign             | Not started |                                                                  |
| G. Route search                   | Not started | Needs Release 1 D                                                |
| H. Social v1                      | Not started | Reuses Release 0 moderation                                      |

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
