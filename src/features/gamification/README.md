# Gamification — runner experience (`feat/runner-experience`)

XP, coins, levels and ranks, habit and weekly streaks, badges, weekly challenges and character stages. All rules live in `logic/` as pure functions (`computeRewards` is the single source of truth). `service.ts` reconciles them into the database with deterministic award keys, so rewards can never be paid twice. Rules are documented in `docs/RUNNER_EXPERIENCE.md`; badge codes must match the `badges` rows in the migration.
