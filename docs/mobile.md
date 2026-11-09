# Mobile companion (workstream J)

The HYD Runners mobile app lives in `mobile/`. It is a small Expo / React Native companion whose one job is **reliable GPS run recording that syncs to the runner's HYD Runners account without duplicates or data loss**. The web app remains the main platform: the mobile app does not replicate web pages (feed, clubs, events, planning). After a run is synced, the runner sees it on the web like any GPX/FIT import.

> Status: code, unit tests, typecheck, `expo-doctor` and JS bundling (`expo export` for Android and iOS) pass in this repository. **No native binary has been built** and nothing has run on a real device: background location, the Android foreground service, iOS background mode, Health Connect and HealthKit are **untested**. Building and releasing need owner accounts (see [Builds and store release](#builds-and-store-release-owner-actions)).

## Layout

| Path                                                         | What                                                                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile/package.json`, `pnpm-lock.yaml`                      | Standalone pnpm package (own lockfile, `nodeLinker: hoisted` in `mobile/pnpm-workspace.yaml`). Expo SDK 58, React Native 0.88, React 19.3.               |
| `mobile/app.config.ts`, `eas.json`                           | App config per variant (development / preview / production) and EAS build profiles.                                                                      |
| `mobile/src/recording/`                                      | **Pure TypeScript core**: GPS filtering, recorder state machine, journal (crash recovery), workouts, audio cue scheduling, sampling policy, upload body. |
| `mobile/src/sync/`                                           | **Pure** upload queue (retry, backoff, idempotency) and the API client.                                                                                  |
| `mobile/src/auth/`                                           | Supabase client and chunked secure-store session storage.                                                                                                |
| `mobile/src/storage/db.ts`                                   | SQLite journal, queue and preferences.                                                                                                                   |
| `mobile/src/native/`                                         | Device glue: location task and permissions, the recording session singleton, the sync runner.                                                            |
| `mobile/src/health/`                                         | `HealthProvider` interface with Health Connect and HealthKit adapters.                                                                                   |
| `mobile/src/ui/`, `App.tsx`, `index.ts`                      | Screens (sign-in, home + sync list, permission explanations, recording, summary, settings) and a tiny state-based navigator.                             |
| `src/app/api/v1/activities/recorded/route.ts`                | Web API endpoint the app uploads to.                                                                                                                     |
| `src/features/activities/logic/recorded.ts`                  | Validation and conversion of recordings into the import pipeline.                                                                                        |
| `supabase/migrations/20261122120000_recorded_activities.sql` | `client_ref`, `'app'` source.                                                                                                                            |

The root `pnpm lint / format:check / typecheck / test / build` ignore `mobile/` (eslint `globalIgnores`, `.prettierignore`, `tsconfig.json` `exclude`, vitest `exclude`). The mobile package has its own checks:

```sh
pnpm --dir mobile install --frozen-lockfile
pnpm --dir mobile typecheck   # tsc --noEmit
pnpm --dir mobile test        # vitest: pure logic only
cd mobile && npx expo-doctor  # dependency / config health
```

CI runs these in a separate `mobile` job in `.github/workflows/ci.yml`.

## Architecture

```
expo-location (task or watcher) ──fixes──▶ session.ts ──▶ JournaledRecorder (pure) ──events──▶ SQLite journal
                                               │                 │
                                               │                 └─ metrics ─▶ cue scheduler (pure) ─▶ expo-speech
                                               ▼
                                     finish → summary → save
                                               │
                                               ▼
                           UploadQueue (pure, SQLite store) ──▶ POST /api/v1/activities/recorded
                                               ▲                     (bearer token, clientRef)
                    expo-network / app foreground / backoff timer
```

The core is pure and deterministic so it is unit tested without a phone. Native modules only feed fixes in and persist bytes.

## Auth

- Email/password sign-in with `@supabase/supabase-js` against the same Supabase project as the web app (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public values).
- The session is persisted in `expo-secure-store` (Keychain / Android Keystore, `AFTER_FIRST_UNLOCK` so background uploads can read it). Secure store values should stay under ~2 KB; sessions can be larger, so `chunkedStorage` splits them into `<key>.0…n` parts and writes the count last (a crash never leaves a torn value).
- Tokens auto-refresh while the app is in the foreground; before an upload, a token expiring within a minute is refreshed.
- **The app never writes tables directly.** Every run goes through the web API, so RLS, rate limits, validation and the service-only metrics path all apply. Recording and saving work signed out; queued runs upload after the runner signs in.

## Recording

`mobile/src/recording/` (pure):

- **Filtering** (`filter.ts`): drop fixes with accuracy worse than **30 m**, implied speed over **12 m/s** (same limit as the server), stale/out-of-order timestamps, invalid coordinates, and **stationary jitter** (a fix within the accuracy radius, 3–15 m, of the last kept fix; or within the combined radius when the device reports standing still). Distance is always measured from the last kept fix, so skipped fixes lose nothing once the runner moves on.
- **Signal indicator**: good ≤ 10 m, fair ≤ 25 m, poor otherwise, none when no fix for 15 s.
- **Recorder** (`recorder.ts`): event-sourced state machine — `start`, `fix`, `pause`, `resume`, `finish`.
  - _Elapsed_ = wall clock since start; _moving (timer) time_ = elapsed − paused time; _current pace_ = last 20 s of kept fixes in the current stretch; _average pace_ = moving time / distance.
  - Fixes while paused do not count. The straight line between the last fix before a pause and the first after it is counted, as the server does, so app and web agree.
- **Crash recovery** (`journal.ts`): every event is appended to SQLite. Fixes are buffered and flushed every 5 fixes or 10 s; start/pause/resume/finish flush immediately. On launch, `JournaledRecorder.recover()` replays the journal; the home screen then offers **“Resume or save the interrupted run”** (resume recording, or finish and review). At most one buffer of fixes (≤ 10 s) is lost on a hard kill. The journal is cleared only after the run is durably in the upload queue.
- **Summary**: distance, moving/elapsed time, average pace, km splits (paused time excluded); save with an optional name, or discard (confirmed). Runs the server would reject (< 1 minute, < 100 m) can only be discarded.

### Background behaviour per platform

With background permission, **all** fixes come from one `expo-location` task (`Location.startLocationUpdatesAsync`) so nothing is counted twice; the task is defined at module scope (`src/native/location.ts`, imported from `index.ts`) so it also works when the OS relaunches the app headless, in which case the session recovers the journal before appending.

- **Android**: runs as a **foreground service** with a persistent notification (“HYD Runners is recording your run”), `foregroundServiceType=location` (`FOREGROUND_SERVICE_LOCATION`), `killServiceOnDestroy: false`. Requires “Allow all the time” on Android 10+. Aggressive OEM battery savers (Xiaomi, Oppo, Vivo, Samsung “sleeping apps”) can still kill it; the journal makes that recoverable but the gap is lost. Untested on devices.
- **iOS**: `UIBackgroundModes: location`, `showsBackgroundLocationIndicator: true` (blue pill), `activityType: Fitness`, `pausesUpdatesAutomatically: false`. The app asks for “Always”; behaviour with only “While Using” is not relied on. Untested on devices.
- **Without background permission**: the app uses `watchPositionAsync`, which only delivers while the app is on screen. The recording screen shows “Keep the app open” and keeps the screen awake (`expo-keep-awake`) while it is visible.

### Battery strategy

`sampling.ts` picks one of three policies, re-applied whenever the app moves between foreground and background or the run is paused:

| Mode                    | Accuracy                   | Interval     | Deferred delivery |
| ----------------------- | -------------------------- | ------------ | ----------------- |
| Foreground (screen on)  | high (`BestForNavigation`) | ~2 s / 5 m   | none              |
| Background / screen off | balanced                   | ~5 s / 10 m  | up to 30 s        |
| Paused                  | low                        | ~30 s / 50 m | up to 60 s        |

Balanced accuracy and batching let the OS keep the GPS radio idle more of the time; fixes still arrive every 10 m of movement so distance stays close. Real-world battery use has **not** been measured.

## Workouts and audio cues

- Built-in planned workouts (`workout.ts`): 6 × 400 m intervals, tempo 3 × 8 min, easy 5 km — each step ends after a distance or a timer duration, optionally with a pace target range. The recording screen shows the current step, what is left and the target.
- Cues (`cues.ts`) via `expo-speech`: workout step changes (priority), split announcements every 1 / 2 / 5 km or never, and pace-target reminders (“Pick it up a little.” / “Ease off a little.”).
- Avoiding excessive interruptions: nothing within 8 s of the previous cue (except step changes); several km crossed at once (GPS gap) collapse into one announcement; pace reminders need 30 s off target and are at most one per 90 s; mute stops everything while the schedule still advances, so unmuting never triggers a burst. After crash recovery the schedule is fast-forwarded silently.
- Preferences (mute, split frequency, pace reminders) are in Settings and stored in SQLite.

## Offline queue and idempotency

- Saving a run creates a `QueuedRun` keyed by the recording's **client-generated UUID** (`clientRef`, from `expo-crypto`), stored in SQLite.
- The queue uploads oldest first, one at a time; overlapping triggers (launch, network back via `expo-network`, app to foreground, retry timer, “Retry now”) share one pass.
- Status per run: **queued → uploading → synced**, or **failed** with the reason and the next retry time.
  - Network errors, 5xx and 202 (“still processing”) retry with exponential backoff and equal jitter: 15 s, 30 s, 60 s … capped at 30 min. 429 honours `Retry-After` (default 10 min).
  - 401 / signed out: the pass stops; it resumes after sign-in.
  - 400 / 413 / 422: **rejected** — no automatic retries; the runner can “Retry now” or “Discard” (confirmed).
- **A run is never deleted before the server confirms it.** On “synced”, only the raw points are dropped; the summary and server activity id stay. Discarding an unsynced run is an explicit, confirmed runner action.
- An upload interrupted by a crash is left as “uploading” and reset to “queued” on the next launch; resending is safe because the server deduplicates by `clientRef`.

## API: `POST /api/v1/activities/recorded`

`src/app/api/v1/activities/recorded/route.ts`, following the other `/api/v1` routes (`requireCaller`, `parseJson`, `ok` / `fail`, standard envelope).

- **Auth**: `Authorization: Bearer <Supabase access token>` (verified with `getClaims()` in `getRequestUser`; the web cookie session also works). The row is inserted with a client acting as the runner, so RLS and the upload rate limit (20/hour, 100/day) apply.
- **Body** (Zod, `RecordedActivityBody`): `{ clientRef: uuid, activityType: "run"|"walk_run"|"walk"|"hike", name?, points: [{ t: ISO-8601, lat, lon, ele?, acc? }] (2–20,000), pauses?: [{ from, to }] }`. Bodies over 4 MB are refused with 413.
- **Processing**: `recordedToParsed()` drops fixes with accuracy > 50 m and fixes inside pauses, and reports the app timer (elapsed − pauses) as the moving time (`moving_source = 'device'`, like a watch's FIT timer). The result goes through the **same** `normalizeActivity()` and `finalize_activity_import()` as GPX/FIT imports: distance, splits, best efforts, elevation, privacy trimming, duplicate detection, workout-log linking and rewards. A canonical JSON copy of the recording is stored in the private `activity-files` bucket as the activity's original file. `source_format` and `import_source` are `'app'`; the web activity page shows “Recorded in the app”.
- **Responses**:
  - `201 { data: { status: "ready", activityId, created: true } }` — stored.
  - `200 { … created: false }` — same runner + `clientRef` already stored: the existing activity is returned, nothing is inserted (concurrent retries are serialised by the unique index; the loser re-reads).
  - `200 { data: { status: "duplicate", activityId } }` — the run matches an activity the runner already has (e.g. imported from a watch); `activityId` is that activity. The app treats it as synced.
  - `202 { data: { status: "processing" } }` — another request is finishing it; retry later.
  - `422 validation_failed` — invalid body, or the recording fails import rules (too short, impossible speed …). Final.
  - `401`, `429`, `500` as elsewhere.
- **Database** (`20261122120000_recorded_activities.sql`): `activities.client_ref uuid`, unique `(user_id, client_ref) where client_ref is not null`, `import_source` and `source_format` may be `'app'`, a check that `client_ref` is only set on app recordings, and an insert-only column grant for `client_ref, import_source` (no update grant: the reference cannot change). Existing RLS is unchanged: runners can only insert their own rows, and only the service role writes metrics.
- **Tests**: `tests/unit/activities/recorded-logic.test.ts` (validation and conversion), `tests/unit/runner/recorded-activities.integration.test.ts` (end to end against local Supabase: bearer auth, idempotent and concurrent retries, per-runner scoping, duplicates, validation), `supabase/tests/database/recorded_activities.test.sql` (pgTAP: uniqueness, immutability, cross-runner writes, service-only finalisation).
- Known edge: if the runner deletes the activity on the web and an old upload of the same `clientRef` is retried later, it is stored again (the app only retries until it gets a confirmation, so this needs a lost response plus a delete in between).

## Health integrations

`src/health/provider.ts` defines `HealthProvider`: `availability()`, `requestPermissions()`, `hasPermissions()`, `readWorkouts(since)`, `revoke()`. Read only — HYD Runners never writes health data.

- **Android — Health Connect** (`react-native-health-connect` 4.x, config plugin included): requests read access to `ExerciseSession` and `Distance`; manifest permissions `READ_EXERCISE`, `READ_EXERCISE_ROUTES`, `READ_DISTANCE` only. Routes are consented per session by Health Connect itself when read. `revoke()` calls `revokeAllPermissions()`.
- **iOS — HealthKit** (`@kingstinct/react-native-healthkit` 16.x + `react-native-nitro-modules`): reads `HKWorkoutType`, `HKWorkoutRouteType` and `DistanceWalkingRunning`; `NSHealthUpdateUsageDescription` is disabled and background delivery is off. HealthKit never reveals whether read access was denied, and iOS has no revoke API, so `revoke()` opens Settings (Health → Data Access).
- Both packages installed cleanly with SDK 58 and pass `expo-doctor`, but they are **native modules that need a development build on a real device**; they are absent from Expo Go and are **untested**. The settings screen degrades to “Not available in this build” if the module is missing. Importing workouts from health stores into HYD Runners is not implemented yet — only the boundary and reading.

## Permissions

- Location is requested **only when the runner first taps Start**, after an explanation screen (what it is used for, privacy, how to turn it off). If it was permanently denied, the app offers to open the OS settings.
- Background location is asked **separately**, once, after its own explanation (“Allow all the time” on Android / “Always” on iOS); the runner can choose “Only while the app is open”.
- Settings shows the foreground and background status (re-checked when returning from the OS settings), with **Open phone settings** to change or revoke. Health access shows its status with Connect / Revoke.
- No microphone, contacts, camera or tracking permissions; `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are explicitly blocked on Android.

## Crash and error reporting

`src/lib/report-error.ts` — `reportError(error, context)` logs to the console in development and keeps the last 50 errors in memory (Settings → Diagnostics). Uncaught JS errors are routed through it (`index.ts`). No third-party service; to add one later, forward from `reportError` only.

## Environments

- `APP_VARIANT` (set by `eas.json` per build profile) selects the variant: `development` (`in.hydrunners.app.development`, dev client), `preview` (`…app.preview`, internal APK/ad-hoc), `production` (`in.hydrunners.app`). Variants install side by side.
- Runtime values are public `EXPO_PUBLIC_*` variables inlined at build time: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_BASE_URL`. For EAS builds set them per EAS environment (`eas env:create --environment development|preview|production`); `eas.json` maps profiles to environments. Locally use `mobile/.env.local` (see `mobile/.env.example`; on a phone use your computer's LAN IP, not `localhost`). **No secrets are committed**, and the Supabase secret key must never be given to the app.
- Point development builds at the local stack / a preview deployment, and production builds at production. The app shows “Configuration missing” instead of crashing when a value is absent.

## Local development

```sh
cd mobile
pnpm install
cp .env.example .env.local   # fill in LAN URLs and the local publishable key
npx expo start               # needs a development build (native modules), not Expo Go
```

The web API must be reachable from the phone (`pnpm dev --hostname 0.0.0.0` at the repo root).

## Builds and store release (owner actions)

None of the following has been done; each needs the owner's accounts or decisions.

1. **Expo / EAS account**: create an Expo account and organisation, `npx eas-cli login`, `eas init` (writes `extra.eas.projectId` into `app.config.ts`), then set the EAS environment variables above.
2. **Android test builds**: `eas build -p android --profile development` (dev client) or `--profile preview` (installable APK). EAS manages the upload keystore, or supply your own; never commit keystores (`mobile/.gitignore` blocks them). Test on real devices from several OEMs, with battery optimisation on and off.
3. **iOS test builds**: requires the **Apple Developer Program** (paid, yearly). Register the bundle identifiers, enable the **HealthKit** capability and **Background Modes → Location updates**, then `eas build -p ios --profile development` / `preview` (ad-hoc devices registered with `eas device:create`) or TestFlight.
4. **Google Play Console** (one-time fee): create the app, upload an AAB from `eas build --profile production`, complete the **Data safety** form (precise location, collected, linked to the account, used for app functionality, not shared; health data read for app functionality; encryption in transit; account deletion), the **background location declaration** with a demo video, the **foreground service type (location)** declaration and the **Health Connect** permissions declaration, a privacy policy URL, and content rating.
5. **App Store Connect**: App Privacy “nutrition label” (precise location, health & fitness, linked to identity, not used for tracking), the **privacy manifest** (`PrivacyInfo.xcprivacy`: declare required-reason API usage of the app and its native dependencies via `ios.privacyManifests` in `app.config.ts`, and check the generated file), justification for “Always” location and HealthKit in review notes, privacy policy URL, and TestFlight review before release.
6. **Signing keys**: Android upload key + Play App Signing; iOS distribution certificate and provisioning profiles (EAS can manage both). Store backups outside the repository.
7. **Production config**: production Supabase URL and publishable key, the production web URL as `EXPO_PUBLIC_API_BASE_URL`, and the `20261122120000_recorded_activities` migration applied to production **before** the app ships.
8. Optional later: OTA updates (`expo-updates`, EAS Update channels per variant), crash reporting service behind `reportError`.

## What is verified vs untested

Verified here: mobile unit tests (filtering, distance/pace, pause/resume, crash-recovery replay, queue retry/backoff/idempotency, API response handling, chunked storage, split and workout cue scheduling), `tsc` typecheck, `expo-doctor` (20/20), `expo install --check`, JS bundling for Android and iOS (`expo export`), resolved app config (`expo config`), the web endpoint (unit + integration tests against local Supabase) and the migration (pgTAP).

Untested: everything that needs a native build or device — real GPS quality, background recording and the foreground service, OS kills and relaunch, battery use, speech output, secure store, SQLite on device, Health Connect and HealthKit, and the UI on real screens.
