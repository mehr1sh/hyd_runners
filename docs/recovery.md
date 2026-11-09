# Recovery, strength and return to running

This is training guidance, not a medical product. Nothing here diagnoses, treats or estimates injury risk, and every health input is voluntary.

## Recovery journal (`/recovery`)

`recovery_entries` holds one entry per runner per day, for today or the last 60 days. Every field is optional, but an entry needs at least one:

- sleep quality (1–5) and hours;
- fatigue, muscle soreness (with areas), energy and stress (each 1–5);
- how hard the workout felt (1–10);
- recovery done (stretching, foam rolling, mobility, massage, yoga, walk, rest);
- private notes.

Entries can be edited and deleted. The page shows a 14-day trend table and the entry history.

**Privacy:**

- Entries are owner-only under RLS.
- Each entry has a **Share with my coach** box, off by default. A shared entry is visible only to a coach with a current assignment and a current coach role, through `private.is_active_coach`. Revoking either removes access immediately; pgTAP covers this.
- Coaches cannot edit entries.
- HYD Coach reads fatigue, soreness and sleep quality for the runner's own questions. Notes never leave the journal.

## Readiness overview

`logic/readiness.ts` deliberately gives **no score**, since there is no defensible way to fold these inputs into one number. It lists signals, each labelled with its source:

| Signal                                                                            | Source                                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Training time in the last 7 days, and rest days                                   | Measured, from activities and strength logs                     |
| This week against the previous three                                              | Estimated (training time only; it can't know how sessions felt) |
| Fatigue, soreness, sleep, energy and stress, from an entry for today or yesterday | Self-reported                                                   |

It then makes one suggestion and lists the inputs that triggered it. The first matching rule wins:

1. **Rest:** fatigue or soreness of 4 or more out of 5, or six days in a row of training. The text recommends a physiotherapist for sharp, local or worsening soreness.
2. **Reduce intensity:** sleep quality of 2 or less, or under 5.5 hours of sleep.
3. **Easy day:** training time more than 30% above the previous three-week average.
4. **Mobility:** no rest day in seven days.
5. **Strength:** no strength session in seven days, with rest days available.
6. **Continue as planned:** otherwise.

Adaptive training (Race prep → Check this week) also uses the seven-day average fatigue.

## Strength and mobility (`/strength`)

The catalogue in `features/training/logic/strength-templates.ts` holds 24 exercises. Each lists its primary and secondary muscles from standard exercise anatomy, a dose and a coaching cue. They cover core, glutes, hip stability, hamstrings, calves, single-leg work, mobility and stretches, grouped into four sessions:

- runner foundation;
- single-leg stability;
- hamstrings and calves;
- mobility reset.

Race plans schedule these sessions on free days.

Logged sessions (`strength_logs`) store the exercise keys and sets. The app only accepts keys from the chosen session. Logs are owner-only and readable by the assigned coach as training history, and they count towards readiness training time.

**Muscle map:** for the last 14 days, it counts each logged set fully for an exercise's primary muscles and as half for its secondary muscles. Unknown exercises are ignored, so the map never claims a muscle the catalogue doesn't support. It is drawn as an SVG (front and back) with a text list of the same data.

## Return to running (`/recovery/return-to-running`)

An eight-week walk-run progression:

- three sessions a week, with a rest day between each;
- from 6 × (1 min run, 2 min walk) up to 20 minutes continuous;
- runners who ran regularly before the break start at week 3.

Before it is proposed, the runner must confirm that it is general guidance and that, after an injury, a doctor or physiotherapist has cleared them. It is created as a `return_to_run` training proposal, so nothing reaches the schedule until the runner accepts it, and sessions can be left out. The assigned coach can review it (workstream D). The rules shown say to stop for pain that changes how you run, to repeat weeks rather than push on, and that joint or bone pain is not normal soreness.
