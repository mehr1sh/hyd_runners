# Dashboard (Today)

`/dashboard` answers three questions in order: what to do today, how it's going, and what's next.

| Order | Panel                                                     | Source                                                                                                         |
| ----- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1     | **Today**                                                 | Planned or programme session, rest day, or done for today (unchanged)                                          |
| 1     | **Run now or later?**                                     | [Running conditions](run-conditions.md) for the city centre, with a link to the hourly forecast                |
| 2     | **Your progress**                                         | Weekly goal, habit streak, level and XP, coins (unchanged)                                                     |
| 3     | **Last 7 days**                                           | `my_activity_summary()` over imported activities: distance, moving time, active days. Links to Performance Lab |
| 3     | **Recent activities**                                     | The 3 latest ready imports. Links to the importer                                                              |
| 3     | **Your challenges**                                       | City and club challenges the runner joined that are running now, with individual or group progress             |
| 4     | **Coming up** and **Upcoming community events**           | Unchanged                                                                                                      |
| 5     | Goal progress, character, weekly challenges, achievements | Unchanged, moved below the activity panels                                                                     |

The Release 2 panels load in parallel (`src/features/dashboard/extras.ts`), using the runner's own client, so RLS applies. Each panel is independent: if one query fails, that panel says "Unavailable right now." and the rest of the dashboard still renders. Empty states tell the runner what to do next (import an activity, join a challenge). Nothing is filled with placeholder data. In tests, the conditions panel shows the labelled sample forecast.
