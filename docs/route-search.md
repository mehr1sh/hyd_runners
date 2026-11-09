# Route search

The Run Explorer (`/routes`) supports structured filters and plain-English search. Both produce the same typed filters, and those are passed to one database function.

## Structured filters

| Filter       | Parameter                                                            | Notes                                                                                          |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Name or area | `text`                                                               | Full-text match on name, area and description, plus a literal substring match on name and area |
| Near a place | `place` (a location id), `radius` (0.5–50 km, default 5)             | Routes whose start is within the radius of a place in the locations directory                  |
| Distance     | `min`, `max` (km)                                                    |                                                                                                |
| Attributes   | `surface`, `terrain`, `difficulty`, `lighting`, `shade` (repeatable) | Several values of one attribute match any of them                                              |
| Must have    | `loop`, `beginner`, `verified`, `water`, `toilets`, `noreports`      | `noreports` hides routes with an open condition report                                         |
| Rating       | `rating` (1–5)                                                       | The average community rating                                                                   |
| Sort         | `sort`                                                               | Best match, nearest start (needs a place), shortest, longest, highest rated, name              |

Routes whose value for a filtered attribute is **unknown** are left out of filtered results, and the page says so. Every active filter is shown as a chip that removes it.

## Plain-English search

A runner can type "flat 5k loop near KBR Park with lights". The page then shows what it understood, for example "about 5 km (4.3–5.8) · near KBR Park · flat · lit · loop", as removable chips.

The parser is in `src/features/routes/search.ts`. It is **rule-based and deterministic**, so no language model or external service is involved. It understands:

- **Distances:** "5k", "10 km", "3 miles", "half marathon" (±15%), "under 4 km", "at least 10 km", "between 3 and 6 km".
- **Places:** any name in the locations directory. The longest matching name wins.
- **Attributes:** terrain, difficulty, surface, lighting ("lit", "night"), shade ("shady").
- **Facilities and other requests:** loop, beginner friendly, verified, water, toilets, "top rated" (4★ or more, sorted by rating), "no hazards".

Any words left over become plain search text.

## Safety

- The parser can only produce values from fixed whitelists. They reach the database as **typed parameters** of `public.search_routes()`, and **no SQL is ever generated** from user input.
- `search_routes()` validates every parameter again and rejects unknown attribute values, sort orders, bad coordinates, oversized radii and text longer than 200 characters.
- Free text is matched as data. It goes through `websearch_to_tsquery`, plus an `ILIKE` pattern with `%`, `_` and `\` escaped.
- The function runs with the **caller's rights** (`security invoker`), so the routes RLS policies still decide what can be found: published routes for everyone, drafts only for their authors and managers. Archived routes are never returned.

Tests: `supabase/tests/database/route_search.test.sql`, `tests/unit/route-search.test.ts`, and the search steps in `tests/e2e/routes.spec.ts`.
