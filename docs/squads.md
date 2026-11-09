# Runner matching and squads

## Matching (`/matching`)

Matching is opt-in, off by default, and stored in `matching_profiles`. The table is owner-only: nobody can read another runner's row directly.

**What a runner sets:**

- easy-pace range and typical distance;
- up to five **coarse areas**: named Hyderabad neighbourhoods, never coordinates;
- days, times of day and goals;
- experience;
- whether they want a partner or a small group;
- a short intro.

**How runners are scored** (`find_running_matches()`, a security definer function). It returns only runners who have opted in, are discoverable (Social v1 setting), aren't blocked in either direction and haven't been dismissed. Points:

| Criterion                   | Points           |
| --------------------------- | ---------------- |
| Pace overlap                | up to 30         |
| Typical distance within 30% | 15               |
| Shared days                 | 5 each, up to 20 |
| Same time of day            | 10               |
| Shared area                 | 20               |
| Shared goal                 | 10               |
| Same experience             | 5                |

Partner-only and small-group-only preferences must be compatible. Matches below 25 points aren't shown.

**What a match shows:** the reasons, the _shared_ areas only, and a pace range rounded to 15 seconds. The page says matches are suggestions, not guarantees, and gives safety advice for meeting in public places.

**What a runner can do with a match:** view their profile and follow (Social v1), invite them to a squad they captain, or dismiss them ("Not for me").

## Squads (`/squads`, `/squads/[id]`)

Squads have 2 to 8 runners, set by the creator. A runner can be in at most five.

### Joining and roles

- Squads are **invite-only** or **open to requests**.
- Every membership change goes through `squad_membership()`:

| Action           | Who                           |
| ---------------- | ----------------------------- |
| Invite           | Captain (not someone blocked) |
| Ask to join      | The runner, for open squads   |
| Accept           | The invited runner            |
| Approve          | Captain                       |
| Decline or leave | The runner themselves         |
| Remove           | Captain (audited)             |
| Make captain     | Captain (audited)             |

- Joining a full squad is refused.
- The last captain must appoint another captain before leaving. When the last member leaves, the squad is archived.

### Privacy

The roster, chat, calendar and dashboard are visible to **active members only**. Invitees and requesters see only the squad and their own row.

### Chat

- Members only, 60 messages an hour.
- Members can report messages through the existing moderation workflow (`report_target` gains `squad_message`), and moderators can hide them.

### Shared calendar

- Members add runs with a meeting point; public places are recommended.
- Before a run starts, members can mark _going_ or _can't make it_.
- _I was there_ is only possible once the run has started.

### Dashboard (`squad_dashboard()`, members only)

- **This week:** collective kilometres against the weekly target, and how many members have run.
- **Members:** each member's active days, kilometres and squad runs attended, sorted by **days active**. Consistency matters more than pace, and paces are never compared.
- **Last week's recap.**
- **Streak:** consecutive weeks on target.
- **Shared achievements**, computed from the weekly totals and never stored, so they can't be duplicated: target hit, four weeks in a row, 100 km together, every member ran in the same week.
- **Challenges:** active challenges that members have joined, with each member's progress from the existing challenge engine (`private.challenge_progress`). This is how squads take part in city and club challenges together.

Squad-scoped challenges (a challenge owned by a squad) aren't a separate challenge type. Squad goals are the weekly target and streak above, and adding a squad scope would mean changing the challenge permission functions shared by every challenge.
