# Challenges v2

Challenges are stored as data: city-wide (created by programme managers and admins) or per club (created by that club's admins only). The original weekly challenges, XP, coins, badges and the weekly leaderboard are unchanged.

## What counts

Progress is always calculated in the database by `private.challenge_progress()`, from **completed workout logs** and **event check-ins**. Every imported activity links to exactly one workout log, so a run that was both logged by hand and imported counts once.

| Kind          | Progress                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `distance`    | Total distance, counting at most 50 km per local day                                                                        |
| `active_days` | Distinct local days with 10 minutes or more of activity                                                                     |
| `activities`  | Activities of 10 minutes or more, counting at most 2 per day                                                                |
| `early_runs`  | Distinct days with an activity starting between 05:00 and 07:30 local time. This is a fixed window, not the actual sunrise. |
| `group_runs`  | Check-ins at weekly group runs                                                                                              |
| `events`      | Check-ins at any event                                                                                                      |
| `places`      | Distinct places from workout logs and checked-in events                                                                     |
| `longest_run` | The longest single activity (goal in metres)                                                                                |

**Rules that keep scoring fair:**

- Activities shorter than 10 minutes never count.
- Logs created more than 3 days after a challenge ends never count, so a challenge can't be backfilled.
- Only the challenge's workout types count. The default is run, walk-run and walk.

Collective (group) challenges add up every participant's progress. A participant who contributed something is rewarded when the group reaches the goal.

## Rewards

`private.settle_challenges(user)` completes every finished challenge the runner joined. It sets `completed_at` with a conditional update and pays the configured XP and coins into `xp_ledger` with the unique key `challenge:<id>`. The reward is therefore paid exactly once, however often or however concurrently settlement runs.

Settlement runs:

- after every workout or import, through `reconcileRewards`;
- when a runner joins a challenge;
- when the challenges pages are viewed.

## Permissions and privacy

- Runners join only active, unfinished challenges they can see. Club challenges are visible only to club members.
- Runners can leave a challenge only before completing it.
- Club admins cannot create city-wide challenges.
- Creating a challenge and changing its status are recorded in the audit log.
- Leaderboards respect the runner's existing "hide me from leaderboards" setting.
