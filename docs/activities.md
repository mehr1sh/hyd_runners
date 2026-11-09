# Activities: GPX/FIT import

This is how imported activities are stored, processed, protected and counted. Imported activities are the source data for Performance Lab, challenges, share cards and the social feed.

## Data model

| Table                    | Who can read it                                                                                                            | What it holds                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activities`             | The owner, plus others when the activity is `ready` and its visibility allows. Follower visibility arrives with Social v1. | Activity type, name, visibility, privacy trim, status, start and end times, elapsed time, moving time and its source, distance, average pace, elevation gain and loss, elevation profile, km and mile splits, best efforts, and the **privacy-trimmed** route (`public_path`) |
| `activity_tracks`        | **The owner only**                                                                                                         | The full route, timestamped GPS samples (`[seconds, lat, lon, ele, metres]`, at most 3,600), heart rate, cadence, the stored file path and the SHA-256 hash                                                                                                                   |
| Storage `activity-files` | The owner only (their own folder)                                                                                          | The original GPX or FIT file at `<user id>/<activity id>`                                                                                                                                                                                                                     |

Runners can only register an upload, which sets the type, name and visibility, and later change the name, visibility and privacy trim. They cannot write metrics, because metrics feed XP and challenges. Every processed value is written by `finalize_activity_import()`, which only the service role may call.

Heart rate, cadence and elevation are stored only when the file contains them. Nothing is estimated or invented.

## Processing pipeline

1. `POST /api/v1/activities` checks the size (at most 15 MB), creates the activity row, and returns a one-time signed upload URL. Uploads are rate-limited to 20 an hour and 100 a day.
2. The browser uploads the file directly to the private bucket.
3. `POST /api/v1/activities/:id/process` does the rest:
   1. It atomically **claims** the row. Only uploaded files, retryable failures, or claims stuck for more than 5 minutes can be claimed, so concurrent calls never process an activity twice.
   2. It downloads the file and computes SHA-256 on the server.
   3. It **detects the format from the bytes**, not the file name or MIME type:
      - FIT: the header signature, parsed with `fit-file-parser` (MIT licence) with CRC checks on.
      - GPX: an XML root of `<gpx>`. Entity declarations are refused.
   4. It normalises the activity (`src/features/activities/logic/normalize.ts`) and finalises it in one database transaction.
4. Validation errors are final. The file and row are deleted, and the importer shows the reason. Unexpected errors keep the row and file so the runner can retry.

## Validation and calculations

**Rejected files:**

- not GPX or FIT, or a corrupted FIT file (CRC mismatch);
- no timestamps (route-only GPX files belong in Routes);
- timestamps that can't be parsed, more than 1% out of order, before 2000, or ending in the future;
- invalid coordinates;
- shorter than a minute, longer than 48 hours, under 100 m or over 300 km;
- an average speed that isn't possible on foot;
- a FIT sport other than running, walking or hiking.

**GPS glitches:** a point implying more than 12 m/s from the previous kept point is dropped. If more than 10% of points are glitches, the file is rejected.

**Distance:** the sum of great-circle distances between kept points. With no GPS (for example a treadmill FIT file), the device's distance is used.

**Moving time:** the device timer when the FIT file has one (`moving_source = device`). Otherwise it is the total of gaps of 30 seconds or less moving at 0.5 m/s or faster (`derived`, shown as "estimated").

**Splits:** per km and per mile, with times interpolated between points. A remainder of 100 m or more is a partial split.

**Best efforts:** the fastest time over 1 km, 1 mile, 5 km, 10 km, half marathon and marathon, from a sliding window over the track. They are labelled "measured from your GPS track, not an official race result".

**Elevation:** gain and loss with 3 m hysteresis, only when at least 90% of points carry an elevation.

## Duplicates

All checks run under a per-runner advisory lock in `finalize_activity_import()`. An import is a duplicate when either:

- the same file (SHA-256) is already stored for that runner; or
- another ready activity started within 60 seconds and has a distance within 3% (minimum 50 m).

A run of the same distance at another time is never treated as a duplicate.

## Manual workouts and rewards

Each ready activity is linked to exactly one workout log:

- **Existing log:** if the runner already logged the same session by hand or with the timer (a completed log starting within 15 minutes that isn't linked to another activity), the activity links to that log. The log is not changed.
- **New log:** otherwise a new completed log is created with source `import`, keyed by the activity id. Activities longer than 6 hours or 100 km get no workout log, because of workout-log limits.

Rewards are recalculated from workout logs as before, so an imported run counts once. Deleting an imported activity deletes the log the import created, but never a manual one. XP already awarded is kept, because the ledger is append-only, and daily award keys stop a re-import from earning the same day twice.

## Privacy

- New activities are **private** by default. The options are private, followers (once Social v1 adds follows) and everyone signed in.
- Others only ever receive `public_path`: the route with the first and last 200 m removed by default (0, 500 m or 1 km are also available). A route shorter than twice the trim plus 100 m is not shared at all.
- Changing the trim recomputes the shared route in the database from the full track.
- The full route, GPS samples, heart rate, cadence and the file are never readable by anyone but the owner. Policies and the integration tests enforce this.
