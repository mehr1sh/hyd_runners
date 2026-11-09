# Advanced group runs and live tracking

## Group-run operations

These Release 1 features are reused:

- event team roles (organiser, captain, sweeper);
- pace groups that runners choose;
- check-in and attendance;
- regroup and no-drop policies on series;
- results;
- run history.

Release 3 adds:

| Feature            | Where                   | How it works                                                                                       |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------------------- |
| Pace-group leaders | Manage → Pace groups    | Any event team member can be set as a group's leader. The database rejects anyone not on the team. |
| Live run           | `/events/[id]/live`     | Linked from the run page for participants and the team, within six hours of the start.             |
| Group recap        | Run page, after it ends | See below.                                                                                         |
| Run Radar          | `/runs/radar`           | See below.                                                                                         |

## Live location sharing

Live location sharing is off by default, opt-in, time-limited and visible only to the run's team. It is not an emergency service; the page tells runners to call 112 in an emergency.

### Sessions

- An organiser, captain or sweeper (or a manager) starts the session with `start_live_session`.
- It can only start from an hour before the run until its end.
- It lasts at most six hours, ending an hour after the run.
- Starting and ending a session are audited.

### Sharing

- Each runner taps **Share my location for this run** and picks 30 minutes to 3 hours (`start_location_sharing`).
- Only runners who RSVP'd as going, or team members, can share.
- While sharing, the runner sees:
  - a status panel showing who can see their position and until when;
  - GPS accuracy;
  - a **Stop sharing now** button.

### Positions

- The browser sends a position at most every 15 seconds through `POST /api/v1/live/[eventId]/position`, using `update_live_position`.
- The database only accepts a position while the share is active. It refuses fixes more than 10 minutes old and updates within 5 seconds of the last one.
- Fixes worse than 100 m aren't sent; the runner sees "GPS is weak".
- Only the latest position is stored.

### Who sees what

- Each runner sees their own position.
- Organisers, captains and sweepers see positions **only while the share is active**: RLS checks `share_is_active` on every read.
- Other participants and the public never see positions.
- Run Radar never uses runners' positions.

### Deletion

Positions are deleted when:

- the runner stops sharing;
- the share expires (`purge_stale_live_positions`, which runs whenever the live view loads);
- the session ends.

### Failure handling

- The captain view marks positions older than 90 seconds as **stale** and older than 10 minutes as **signal lost**. These are drawn faded and dashed on the map, and never shown as current.
- If the runner revokes the browser's location permission, the page says nothing is being shared.
- The page polls every 15 seconds and keeps the last state while offline.
- Browsers stop location updates when the screen locks. The page says so; the native app (workstream J) is the reliable recorder.

### Help

- **Ask the team for help** (`request_live_help`, 10 an hour) records an optional note and the last known position.
- The team is notified.
- The runner or the team can mark it resolved.

## Group recap (`group_run_recap`)

Once a run has ended, its page shows:

- how many were going, checked in and finished;
- check-ins per pace group;
- the total distance of checked-in runners' own activities that started within 30 minutes of the run window.

The distance appears only when **at least three** such activities exist, so no individual's run can be singled out.

## Run Radar (`/runs/radar`)

Run Radar maps published group runs in the next two weeks at their meeting places. Each shows its start time, open spots (or "full, waiting list") and pace groups.

## Security headers

`Permissions-Policy` previously denied geolocation everywhere. It now allows geolocation for this origin only (`geolocation=(self)`), never for embedded or third-party frames. Every other powerful feature is still denied, and tests assert both.
