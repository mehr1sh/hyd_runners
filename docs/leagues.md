# Leagues

Leagues (`/leagues`) are team competitions over a fixed window.

## League types

| Type                    | Notes                                                     |
| ----------------------- | --------------------------------------------------------- |
| Club vs club            |                                                           |
| University              |                                                           |
| Corporate               |                                                           |
| City-wide               |                                                           |
| Seasonal                |                                                           |
| Beginner                | Runners whose profile says "running regularly" can't join |
| Consistency competition |                                                           |

## Organising

- Programme managers and admins create leagues.
- The creator becomes a league admin, and admins can appoint more.
- Leagues start as **drafts**, visible only to their admins.
- Admins add teams, adjust the scoring weights and open the league. Creating, editing and deleting leagues and teams is audited.

## Teams and joining

There are two kinds of team:

- **Club teams** are open to that club's active members only.
- **University, company and open teams** use an 8-character join code. Only league admins can see codes (`league_team_codes`); the column isn't readable by anyone else.

**Joining** happens only through `join_league_team`:

- one team per league;
- team size limits;
- no joining after the league ends;
- rate-limited.

Runners can leave a league, and admins can remove members.

## Scoring

The league page shows the scoring rules. Points never reward speed, and the database rejects any metric outside this list:

| Metric                                        | Default points |
| --------------------------------------------- | -------------- |
| Active day (any run or walk that day)         | 10             |
| Week with 3 or more active days               | 25             |
| Checked-in group run or event                 | 15             |
| Every 5 km (capped at 50 km a day per runner) | 5              |
| Completed challenge                           | 20             |
| Finished event or race                        | 30             |

- Weights range from 0 to 100.
- Consistency and beginner leagues default to 0 points for distance and more for consistent weeks.
- Club leagues weight group runs more.

### Data sources and duplicate resistance

- Only `ready` activities between the league's start and end dates count, local time.
- Several activities on one day count as **one** active day.
- Import duplicate detection already stops the same run being imported twice.
- Distance is capped per day.
- Group runs count only when checked in by the event team.
- Challenges count only when completed by the challenge engine.
- Events count only for organiser-recorded finishes.
- Standings are computed on request (`league_standings`) rather than stored, so nothing can be paid twice.

## Leaderboards

The league page has two tables:

- **Teams:** points, points per runner, active days, kilometres and runner count.
- **Runners:** up to 50, with points and their breakdown.

Runners who turned off **show on leaderboards** (`runner_settings`) still count for their team but appear as "Hidden runner"; they see their own name.
