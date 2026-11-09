# Share cards

Runners can turn an imported activity, or a challenge they completed, into a PNG image to post anywhere.

## Where

- **Activity page** (`/activities/[id]`): a "Share card" panel, shown to the owner only.
- **Challenge page** (`/challenges/[id]`): "Share your achievement", shown once the runner has completed the challenge.

The panel shows a live preview and lets the runner choose a format, download the card, or use the device's share sheet where the browser can share files (Web Share API Level 2). Otherwise it suggests downloading instead.

## Formats

| Format | Size        | Use                    |
| ------ | ----------- | ---------------------- |
| Square | 1080 × 1080 | Feed posts             |
| Story  | 1080 × 1920 | Stories and status     |
| Wide   | 1200 × 630  | Link previews and chat |

## Rendering

Cards are rendered on the server by route handlers that use `ImageResponse` from `next/og` (Satori and Resvg, bundled with Next.js). There is no external service and no cost.

- `GET /api/v1/activities/:id/card?format=square|story|wide&route=0&pace=0`
- `GET /api/v1/challenges/:id/card?format=square|story|wide`

Responses are `image/png` with `Cache-Control: private, no-store`.

## Privacy

- **Owner only.** The activity card queries `activities` with the caller's own client (RLS) **and** `user_id = caller`. Another runner gets 404 even when the activity is public, and a signed-out request gets 401. The challenge card needs the caller's own completed participation row.
- **Only the privacy-trimmed route** (`public_path`) is drawn, never the full track. The shape is reduced to at most 400 points and rounded to whole pixels, with no map tiles, coordinates or place names. If the trimmed route is empty (a short activity with a large trim), no route is drawn.
- **The date, never the time** (Asia/Kolkata), because start times reveal routines.
- **No heart rate, cadence or GPS samples.** The handler never selects them.
- The runner can hide the route shape and the pace.
- Best efforts carry the label "GPS measured, not an official result".

Tests: `tests/unit/share-cards.test.ts`, plus card steps in `tests/e2e/activities.spec.ts` (size, headers, 404 for another runner, 401 when signed out) and in `tests/e2e/challenges.spec.ts`.
