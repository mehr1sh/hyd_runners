# Adaptive training and race preparation

`/training` (Train → Race prep) builds on the existing planner. Generated sessions are written into the same `scheduled_workouts` the schedule uses, and only after the runner accepts them.

## Race goals

`race_goals` stores one active goal per runner:

- distance: 5K, 10K, half or marathon;
- race date, within the next year;
- optional name, target time and event link;
- current level, training days per week and long-run day.

Goals are owner-only under RLS. Setting a new goal closes the previous one, and a goal can be marked completed or dropped.

## Proposals: nothing changes silently

Every change to a schedule is a row in `training_proposals`. A proposal holds an ordered list of changes:

| Operation     | Effect                                                |
| ------------- | ----------------------------------------------------- |
| `add`         | Adds a session                                        |
| `move`        | Reschedules a session (existing `reschedule_workout`) |
| `shorten`     | Reduces a session's duration; never lengthens it      |
| `cancel`      | Marks a planned session as skipped                    |
| `mark_missed` | Marks a planned session as missed                     |

The runner reviews each change and can:

- accept all of them;
- accept some, by unticking the rest;
- reject the proposal.

`decide_training_proposal(id, accept, skip[])` applies the selected changes in one transaction with the runner's own rights, so `scheduled_workouts` RLS applies to every change. If any change no longer fits the schedule (for example, a session was already moved), the whole acceptance fails and nothing is kept. Runners have no direct update grant on proposals. The decision and the changes applied are recorded on the row.

Proposal kinds:

- `race_plan`
- `missed_session`
- `adaptive`
- `coach`: filed through the human coach tools (workstream D); runners cannot create these.

## Race plan generator

`logic/race-plan.ts` runs base → build → peak → taper → race week:

| Distance      | Typical weeks | Minimum weeks |
| ------------- | ------------- | ------------- |
| 5K            | 8             | 4             |
| 10K           | 10            | 6             |
| Half marathon | 12            | 8             |
| Marathon      | 16            | 12            |

No plan is longer than 20 weeks. Rules:

- **Volume:** weekly distance starts from the runner's last four weeks. It grows by no more than about 8–10% over the biggest week so far, and every fourth week is about 20% easier. Taper: one week for 5K and 10K, two weeks for the half and marathon.
- **Long runs:** about a third of the week, capped per distance (5K 10 km, 10K 15 km, half 19 km, marathon 32 km). They fall on the runner's chosen day.
- **Quality sessions:**
  - zero to two a week, depending on level and days;
  - beginners get none in base weeks;
  - each is at least two days away from the long run and from the other quality session.
- **Strength:** a strength session is added on a free day when training five days a week or fewer. It uses the exercise catalogue in `logic/strength-templates.ts`.
- **Warnings:** shown for short timelines and for marathon goals on under 20 km a week. The plan is labelled as a recommendation throughout.

## Missed-session recovery

`missedSessionProposal()` in `logic/adapt.ts`:

| Missed session            | Proposal                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Easy session              | Let it go. The plan doesn't change, and there's no make-up.                                                                                                                         |
| Long run                  | Move it, about 20% shorter, to a free day in the next three days. The day must have no hard session the day before or after, and must be at least four days from the next long run. |
| Quality session           | Swap it into an easy session in the next three days with free neighbours. The easy run is cancelled, so weekly load is unchanged.                                                   |
| Within a week of the race | Let it go.                                                                                                                                                                          |

When there's no safe slot, the session is let go, with an explicit "don't add it to your next sessions".

## Adaptive adjustment

**Check this week** compares the last 14 days of planned and completed sessions, plus average journal fatigue once the recovery journal exists. Below 60% completion (with at least three sessions), or fatigue of 4 or more out of 5, triggers a proposal for one easier week:

- quality sessions become easy runs at 80% of their time;
- long runs are shortened by 20%.

Otherwise it reports "continue as planned" with the numbers behind that.

## Race estimates, paces and workouts

- **Race estimates:** Riegel's formula from the closest GPS best effort of 5 km or longer in the last 180 days. See `logic/predict.ts`, which is shared with HYD Coach.
  - Each estimate has a range that widens with extrapolation and age.
  - It refuses targets more than 4.5× the effort's distance.
  - Limitations and the calculation date are shown.
- **Training paces:** derived from the 5K estimate as ranges. With no estimate, workouts use effort levels only.
- **Workout generator** (`/training/sessions`): easy, recovery, long, tempo, intervals, progression and hills. Each has a warm-up, main set with recoveries, cool-down, total time and effort guidance, and volumes are scaled to level.
- **Pace calculator** (`/training/pace`):
  - works out pace, finish time or distance;
  - per-mile and km/h conversion;
  - even or negative-split race pacing tables;
  - interval targets.

## Heat-aware guidance

For sessions in the next seven days that fall inside the forecast window, `logic/heat.ts` bands the forecast by feels-like temperature, moving up one band at 75% humidity or more:

| Band     | Feels like      | Guidance                             |
| -------- | --------------- | ------------------------------------ |
| None     | under 24 °C     | No adjustment                        |
| Warm     | 24–28 °C        | About 2–4% slower at the same effort |
| Hot      | 28–32 °C        | About 4–8% slower                    |
| Very hot | 32–36 °C        | About 8–12% slower                   |
| Extreme  | 36 °C and above | Avoid hard efforts                   |

Hard sessions are shortened or swapped in heat, and long sessions get water advice. These are labelled as coaching heuristics with heat-illness stop signs, not measurements. The forecast comes from MET Norway for the city centre. Sample data is labelled as not live.
