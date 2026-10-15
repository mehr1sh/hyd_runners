# Workouts and programmes — runner experience (`feat/runner-experience`)

Workout tracking (start → complete, manual entry, history) and programmes (catalogue, enrolment, sequential progress, rest days). Writes go through `service.ts` with the secret key after `actions.ts` verifies the user; runners can only read their rows. See `docs/RUNNER_EXPERIENCE.md`.

- `logic/` — pure, unit-tested: validation and plausibility, programme progress.
- `planned-source.ts` — read-only adapter for the scheduler's `scheduled_workouts` (PlannedWorkout contract).
