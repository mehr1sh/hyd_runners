# Visual and storytelling features

Everything here draws only the runner's real, recorded data, with no invented metrics or routes. Every route drawn is the privacy-trimmed shared route, never the full track.

## Posters

Activity share cards gain **styles** in the existing share card panel:

| Style             | Description                                           |
| ----------------- | ----------------------------------------------------- |
| Classic           | The original card                                     |
| Neon route (dark) | Bright route with a glow on a dark background         |
| Minimal city line | Thin black route on white                             |
| Elevation profile | The recorded elevation profile as a filled silhouette |

- They use the same owner-only renderer (`/api/v1/activities/[id]/card?theme=…`) and the same privacy rules: date only, the route and pace can be hidden, and there's no heart rate or exact coordinates. Unknown themes fall back to classic.
- **Monthly training poster:** `/api/v1/me/poster?month=YYYY-MM&theme=neon|classic`, owner-only and not cached. It shows the month's real distance, activity count, active days and moving time, plus up to 12 trimmed route thumbnails. Download it from Wrapped.

## Animated recap

On the owner's activity page, the shared route draws itself:

- distance and time count up to the recorded totals;
- a marker appears at each kilometre from the recorded splits.

Nothing between recorded points is interpolated. With `prefers-reduced-motion` it shows the final frame.

## Running Wrapped (`/wrapped`)

Wrapped uses `my_year_in_running` (Performance Lab) plus the year's activities. It shows:

- total distance, moving time, activities and elevation;
- the longest run and the fastest 5 km (GPS, labelled);
- the most active month and the most repeated route;
- active weeks and the longest weekly streak;
- group runs and events checked in, and clubs;
- the year's GPS best efforts;
- pace progress between the first and latest runs, only with 10 or more qualifying runs;
- the first activity date.

Metrics without data are left out. The current and previous two years can be selected.

## Profile customisation

Profile → **Profile style**:

- theme: classic, night, sunrise or lake;
- up to six showcase badges, from badges actually earned (the database ignores any others);
- up to five favourite published routes;
- opt-in race history and best efforts.

`runner_showcase()` returns these with the same block rules as `runner_profile()`:

- active clubs are shown;
- race history shows organiser results and completed passport entries, with their source;
- best efforts come only from the runner's non-private activities.

## Activity stories

`activity_reflections` holds the runner's answers to: what was difficult, what they enjoyed, who they ran with and what they achieved, plus a story.

- **Private by default.** "Show my story" shares it only with people who can already see the activity (RLS re-checks the activity's visibility).
- **Suggestions** (`storySuggestions`) are built only from the runner's own words and the activity's recorded distance and time. Sentences for empty answers are left out, and no AI is used. Suggestions are only offered; the runner edits and chooses.
