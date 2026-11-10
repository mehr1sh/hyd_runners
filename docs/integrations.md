# Wearable and health integrations

Every activity source produces the same provider-neutral `ParsedActivity`. All sources then go through `normalizeActivity()` and `finalize_activity_import()`, so metrics, best efforts, privacy trimming and duplicate detection work identically. The core activity model isn't tied to any provider. The current status is at Profile → **Connected apps and devices** (`/profile/integrations`).

| Source                        | Status                                                               | How it works                                                                          | What's needed                                                              |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| GPX and FIT files (any watch) | **Available** and production verified (Release 2 A)                  | Import at `/activities/import`                                                        | None                                                                       |
| HYD Runners app               | Implemented; API in production; app not published                    | `POST /api/v1/activities/recorded`, idempotent per recording ([mobile.md](mobile.md)) | Owner's Apple and Google developer accounts, signing, store review         |
| Health Connect (Android)      | Read-only adapter in the app (exercise, routes, distance)            | Runs in the app with on-device permission                                             | Development build, real device, Play Console health-permission declaration |
| Apple Health (iOS)            | Read-only adapter in the app (workouts, routes, distance)            | Runs in the app with HealthKit permission                                             | Apple Developer Program, HealthKit capability, real device                 |
| Strava                        | **Not enabled.** OAuth and import client implemented and unit-tested | `src/features/integrations/strava.ts`                                                 | See below                                                                  |

## Strava

### What exists

- **OAuth:** the authorise URL asks only for `activity:read`; the code exchange refuses grants without it.
- **Tokens:** exchange and refresh, refreshing an hour before expiry.
- **Errors:** 401, 403, 429 and 5xx are mapped to typed errors.
- **Import:** an activity list (after a timestamp, paged); only Run, Trail Run, Virtual Run, Walk and Hike are importable. Streams (time, position, altitude, distance, heart rate, cadence) are converted into `ParsedActivity`.

These are tested with fixtures. No route is wired, and no request is made to Strava.

### Why it's off

Strava's API agreement, as reported since November 2024 and still to be confirmed against the current text:

- an app may show a user's Strava data **only to that user**;
- **AI use** is restricted;
- the June 2026 changes reportedly add **subscription requirements** for some developer tiers.

HYD Runners shares activity-derived data with followers, squads, leagues, recaps and coaches, and HYD Coach can phrase answers with an AI provider. Enabling Strava therefore needs:

1. **Owner actions:** register the app with Strava, get it approved, and review the current agreement. Signing up for a paid tier is a spending decision for the owner.
2. **A migration** adding:
   - a `strava` import source with an external id, unique per runner, for duplicate detection;
   - a private-schema token table readable only by the service role;
   - a connections table with sync history;
   - `revoke_integration()`, which deletes tokens and, if the runner chooses, every Strava-imported activity.
3. **Enforced exclusion** of Strava-sourced activities:
   - they are always private;
   - they are left out of every multi-user aggregate (squads, leagues, group recap, coach overview, challenge leaderboards);
   - they are never included in HYD Coach's AI phrasing; deterministic answers for the owner are allowed.
4. **Sync:** an initial sync from a chosen date, incremental sync and webhook handling (the athlete-deauthorisation event triggers revocation), with retry on 429 honouring Strava's rate-limit headers.
5. **Environment:** `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` as server-only variables.

There's no scraping and no bypassing of Strava's permissions.

## Health data principles

Health data from wearables is:

- read-only and minimised: workouts, routes and distance only, with no clinical data;
- revocable in the operating system's settings;
- stored only as activities the runner owns.

It is never shared with coaches, other runners or AI providers unless the runner explicitly shares it.
