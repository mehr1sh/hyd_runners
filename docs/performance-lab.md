# Performance Lab

Every figure in the Performance Lab comes from the runner's own **ready imported activities**. The database aggregates them using the caller's own rights (`auth.uid()`), so RLS still applies. Nothing is estimated unless it is labelled as an estimate. Manual workout logs don't contribute to pace, splits, records or route analysis, because they only record totals.

## Functions

| Function                                                        | What it returns                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `my_activity_summary(from, to, tz)`                             | Activity count, distance, moving and elapsed time, elevation gain, average pace, active days, longest activity, and run/walk/hike counts |
| `my_weekly_series(from, to, tz, types)`                         | Per Monday-starting local week: activities, distance, moving time, average pace and active days (at most 520 rows)                       |
| `my_best_efforts()`                                             | The fastest GPS best effort per distance across all runs, with its activity                                                              |
| `my_pace_by_distance(from, to)`                                 | Average running pace in five distance bands                                                                                              |
| `my_training_mix(from, to, long_factor, hard_pct, easy_pct)`    | Sessions per inferred category (see below) plus strength, mobility, conditioning and cross-training from workout logs                    |
| `my_route_matches(activity, endpoint_m, distance_pct, shape_m)` | The caller's activities on the same route (see below)                                                                                    |
| `my_year_in_running(year, tz)`                                  | Totals plus highlights the data supports                                                                                                 |

All averages weight by distance: total moving time divided by total distance. Planned versus completed counts planner workouts in the period that weren't rescheduled, against completed workout logs linked to a planned workout.

## Personal bests

Best efforts are the fastest time over 1 km, 1 mile, 5 km, 10 km, half marathon and marathon anywhere in an activity. They use a sliding window over the cleaned track (see [activities.md](activities.md)).

They are labelled **"measured from your GPS tracks, not official race results"**. Official event results, which organisers record, are listed separately. Predicted times are not shown; race prediction is part of Release 3 and will be labelled as an estimate.

## Splits and pacing

Km and mile splits are stored when an activity is imported. The pacing analysis uses only full kilometres and needs at least two:

- **Negative split:** the second half's average pace is more than 1% faster than the first half's.
- **Positive split:** the second half is more than 1% slower.
- **Even:** anything in between.
- **Consistency:** the coefficient of variation of the split paces. Under 3% is "very even", under 6% is "steady", and anything higher is "variable".

## Training mix (inferred)

The mix is inferred from pace and distance, **not heart rate**. Each run is compared with the runner's median run distance and median pace over the period plus the 90 days before it:

- **Long:** at least `long_factor` (1.5) × the median distance, and at least 8 km.
- **Hard:** a pace at least `hard_pct` (7%) faster than the median pace.
- **Recovery:** under 5 km, and at least `easy_pct` (10%) slower than the median.
- **Easy:** everything else. Walks and hikes are counted separately.

The page states that these categories are inferred.

## Same-route matching

Two activities count as the same route when all of these hold:

- both starts and both ends are within `endpoint_m` (200 m) of each other;
- the distances are within `distance_pct` (5%);
- the discrete Hausdorff distance between the full tracks is at most about `shape_m` (120 m).

The Hausdorff distance is computed in degrees and multiplied by 111,320 m. Away from the equator this slightly overstates east–west gaps, so the check can only miss a match, never create one. Matching uses the owner's full tracks and is available only to that owner.

## Running DNA

Running DNA is computed from the last 16 weeks, and says nothing unless there are at least 4 activities in the last 8 weeks. Every trait displays the evidence it rests on:

| Trait                 | Shown when                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Consistency Runner    | Active in at least 6 of the last 8 weeks                                                                                             |
| Weekend Explorer      | At least 60% of distance in the last 8 weeks came on Saturdays and Sundays                                                           |
| Long-Distance Builder | The longest run in the last 4 weeks is at least 25% longer than in the 4 weeks before, which must have included at least 3 km        |
| Speed Chaser          | Distance-weighted running pace over the last 4 weeks is at least 3% faster than the 4 weeks before (both periods need at least 3 km) |
| Comeback Runner       | Inactive in weeks 3–5 ago, active in at least two of the last three weeks, with earlier history                                      |

The distance trend compares the last 4 weeks with the 4 before, when the earlier period has at least 5 km.

## Year in running

The year report shows these sections only when the data exists: totals, longest activity, fastest 5 km best effort, most active month by distance, most repeated route, group runs and events checked in to, and current clubs.

"Most repeated route" groups activities by the start of their shared route, rounded to about 100 m, and by distance, rounded to 500 m. It needs at least two activities.
