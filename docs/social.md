# Social v1

Social v1 adds follows, a feed, kudos and comments on activities, runner search and profiles, and blocks and reports. It reuses the existing moderation workflow. Migration: `20261118120000_social_v1`.

## Privacy model

| Data                            | Who can see it                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile row (`profiles`)        | Still the owner only (and staff). Others see a **minimal card** through `runner_profile()`: name, bio and follower counts. Never email, roles or training data                                   |
| Search (`search_runners`)       | Discoverable profiles only (`discoverable`, on by default and switchable off). Never yourself, never across a block. Needs 2–60 characters; wildcards match literally                            |
| Activity                        | The owner; everyone signed in when `public`; **accepted followers** when `followers`; nobody when `private`. Never across a block, and never once hidden by a moderator                          |
| Full track, heart rate, cadence | The owner only (unchanged)                                                                                                                                                                       |
| Start time                      | Others see the **date only**, on the activity page, the feed and runner profiles                                                                                                                 |
| Kudos and comments              | Whoever can see the activity, minus anything from or to a blocked runner. Hidden comments are visible only to their author                                                                       |
| Names                           | `private.social_name()` returns a name only when there is a social connection: yourself, a follow in either direction, a comment or kudos on a visible activity, or a visible activity of theirs |

## Follows

- `follows(follower_id, followee_id, status)`. A trigger sets the status; clients cannot.
  - **Approval is on by default** (`approve_followers`), so requests stay `pending` until the followee accepts.
  - With approval off, follows are accepted immediately.
- The only update allowed is the followee accepting a pending request (`pending → accepted`).
- Either side can delete the follow (unfollow, decline, or remove a follower).
- Rate limit: 60 follows an hour.

## Blocks

`user_blocks` rows are private to the blocker. A block:

- removes follows in both directions, and stops the blocked runner from following again;
- hides every activity, comment and kudos between the two runners, in both directions;
- hides the blocker's profile from the blocked runner (`runner_profile` returns nothing, so the page is a 404) and removes both from each other's search.

## Kudos and comments

- **Kudos:** one per runner per activity, never on your own activity. Activities must be visible and ready. Rate limit: 300 an hour.
- **Comments:** 1–500 characters, already trimmed. Clients cannot set moderation fields. Rate limit: 30 an hour.
  - Only the author or the activity owner can delete a comment.
  - Comments are offered on non-private activities, and on your own.

## Feed

`activity_feed(before, limit)` runs with the caller's rights. It returns your own activities and those of runners you follow (accepted follows), ready and not hidden, newest first. RLS still decides visibility. Pages hold 20 items and use cursor paging on the start time. Each item shows the privacy-trimmed route preview only.

## Reports and moderation

`report_target` gains two targets: `activity` and `activity_comment`. `report_content`, `moderation_report_content` and `resolve_report` are extended without changing their behaviour for existing targets:

- Only content you can see can be reported, and you can't report your own.
- For an activity, moderators see a summary (name, distance, visibility), **never the track**.
- `hide_content` sets `hidden_at`. A hidden activity disappears for everyone but its owner. A hidden comment disappears for everyone but its author. Both are audited (`activity.hidden`, `activity_comment.hidden`).

## Pages

- `/feed`: Community → Feed.
- `/runners`: Community → Runners. Search, follow requests, followers, following, social settings (bio, approval, discoverability), and blocked runners.
- `/runners/[id]`: a profile with follow or unfollow, block or unblock, and the activities you can see.
- `/activities/[id]`: kudos, comments, and reporting a comment or an activity.

Tests: `supabase/tests/database/social_v1.test.sql` (47 tests) and `tests/e2e/social.spec.ts`, which covers search, request, accept, feed, kudos, comment, report and block, followed by a full lockout.
