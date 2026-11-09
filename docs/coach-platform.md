# Human coach platform

The platform builds on the Release 0 access rules. Every coach query goes through `private.is_active_coach(coach, runner)`, which checks two things on every call:

- **a current assignment** in `coach_assignments`;
- **a current staff role**: coach, mentor, programme manager or admin.

Removing either removes access immediately, with no cached permission. pgTAP covers revocation.

## What a coach sees (`/coach`, `/coach/runners/[id]`)

### Your runners

`coach_runner_list()` returns, for each assigned runner:

- active programme;
- last 7 days' distance;
- planned vs completed sessions over 28 days;
- race goal;
- the coach's open proposals;
- recent runner replies.

### Runner page

`coach_runner_overview(runner)` returns summaries only:

- 12 weeks of weekly distance;
- the last 20 activities (date, distance, time, pace);
- GPS best efforts;
- sessions from 14 days ago to 21 days ahead, with status;
- race goal;
- recent strength sessions.

Coaches can't query the runner's tables directly, so private activities stay unreadable outside this summary.

**What coaches never see:**

- GPS tracks and routes;
- activity files;
- journal entries the runner didn't share;
- HYD Coach conversations.

### Runner switch

**Let my assigned coach see my training summaries** (`profiles.coach_sees_training`, on by default) is on Race prep → Your coach. When it's off, the list and overview show "not shared". Notes and replies still work.

### Recovery

Only entries the runner shared one by one (see [recovery.md](recovery.md)).

## Feedback, notes and replies

The coach chooses one of three kinds:

| Kind             | Can link to                                              |
| ---------------- | -------------------------------------------------------- |
| Workout feedback | One of the runner's own activities or sessions (checked) |
| Progress note    | —                                                        |
| Recommendation   | —                                                        |

- The runner sees notes on Race prep → Your coach.
- Either side can reply. Replies are visible only to the runner and their current coach.
- Notes are audited (`coach.note`) and rate-limited (100 a day).

## Proposing plan changes

`coach_propose_changes(runner, title, summary, reasons, changes)`:

- **Allowed changes:** shorten, remove or move the runner's planned sessions, or add a future session. It refuses sessions that belong to anyone else.
- **Storage:** a `training_proposals` row of kind `coach`.
- **Audit and notice:** the proposal is audited (`coach.propose`) and the runner is notified.

The runner reviews it like any other proposal on Race prep: accept all of it, accept part, or reject. A coach can never accept on the runner's behalf; the decision function only works for the runner. The coach is notified of the decision and sees the outcome and how many changes were applied. Coaches also see their runners' return-to-running proposals.

## Notifications (`/notifications`)

`notifications` rows are written only by database functions, for:

- coach notes;
- replies;
- proposals;
- proposal decisions;
- verification decisions.

Runners can read, mark as read and delete their own. The page is linked from the account menu.

## Professional profiles and verification

`professional_profiles` holds:

- profession: running coach, strength coach, physiotherapist, nutritionist or run captain;
- headline, bio, years of experience, specialisations;
- credentials: name, issuer, year and reference;
- a `listed` flag.

**Verification status:** unverified (the default), pending, verified, rejected or suspended.

- The owner edits the profile but can never set the status.
- `request_professional_verification()` moves the profile to pending. It needs at least one credential.
- `review_professional()` is **admin-only**, and an admin cannot review their own profile. The UI requires a note on how the credential was checked. The decision is audited (`professional.verified` and so on) and the professional is notified.
- Changing credentials or profession sends a verified profile back to unverified.
- Others see listed profiles that aren't suspended. Only `verified` is ever shown as verified; every other status reads as "Not verified", "Verification pending" or "Suspended".

Admins review at `/manager/professionals`. The platform doesn't check credentials itself: an admin must confirm each one with the issuing body. Workstream K builds the marketplace on these profiles.
