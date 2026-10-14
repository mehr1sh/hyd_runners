# Gamification — owner: Training (Developer B)

Scope: XP and coins ledger (`XpTransaction`), streaks, badges, character evolution, leaderboards, `AchievementSummary`.

Rule: XP, coins, badges and streaks are written only server-side (Postgres triggers or security-definer functions). Clients never insert into these tables.
