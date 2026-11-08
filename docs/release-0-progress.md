# Release 0 progress

Release 0 covers security, infrastructure reliability and administrative foundations. This file tracks its state and is updated as PRs merge and migrations are applied.

Last updated: 2026-11-08. `main` is at `30fa608`, and production migrations are applied up to `20261108150000`.

## Status

| Workstream                               | Status                          | PR                                                    | Commits                         | Migration                                 |
| ---------------------------------------- | ------------------------------- | ----------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| A. Coach and message access              | Ready for review                | [#6](https://github.com/mehr1sh/hyd_runners/pull/6)   | `2023872`                       | `20261109120000_coach_and_message_access` |
| B. Reports, moderation, audit log        | Ready for review, stacked on #6 | [#7](https://github.com/mehr1sh/hyd_runners/pull/7)   | `301566d`, `666c0a8`, `a6f13fd` | `20261109130000_moderation_and_audit_log` |
| C. Security headers, demo-seed hardening | Ready for review                | [#8](https://github.com/mehr1sh/hyd_runners/pull/8)   | `e8b1d8a`, `6b7f1d9`            | none                                      |
| D. CI and workflow reliability           | Ready for review                | [#10](https://github.com/mehr1sh/hyd_runners/pull/10) | `141892c`, `1e42d8d`            | none                                      |
| E. Rate limits, row cap, correctness     | Ready for review, stacked on #7 | [#11](https://github.com/mehr1sh/hyd_runners/pull/11) | `ad23993` (plus merges of #7)   | `20261109140000_limits_and_correctness`   |
| F. Password reset                        | Ready for review                | [#9](https://github.com/mehr1sh/hyd_runners/pull/9)   | `12db65d`                       | none                                      |
| G. Production deployment protection      | Waiting for owner settings      | none                                                  | none                            | none                                      |

Nothing is merged or applied to production yet.

## Migrations

Apply these strictly in this order. Each one depends on the one before it.

1. **`20261109120000_coach_and_message_access`**
   - Coach access now needs a current staff role.
   - A cleanup trigger runs when a role is revoked.
   - Messages are readable only by their two participants.
   - `can_message` is narrowed.
   - Stale assignments are removed once, and the count is reported in a notice.
2. **`20261109130000_moderation_and_audit_log`**
   - Adds `content_reports`, the report functions, and `hidden_at` on messages and feedback replies.
   - Adds `audit_log` with its audit triggers, and the shared rate-limit helper.
3. **`20261109140000_limits_and_correctness`**
   - Adds per-user rate-limit triggers, `consume_rate_limit`, `my_reward_totals` and `my_active_dates`.
   - Validates timezones and resets invalid stored values, with the count reported in a notice.

None of them deletes user data. Enrolments, feedback, replies and messages are always kept.

## Tests

The combined branch is all six PRs merged locally. On it:

- Lint, `format:check`, typecheck and build are clean.
- pgTAP: every file passes, including the new files below.
  - `coach_message_access`: 60 tests. 26 of them fail against the previous policies.
  - `moderation_audit`: 66 tests.
  - `limits_correctness`: 33 tests.
- Unit and integration: 379 passed, 0 skipped. This includes the scheduler API suite and concurrent bursts:
  - 14 reports: 9 accepted, the rest refused.
  - 25 messages: 20 saved.
  - 12 workouts: 10 saved.
- Playwright: 76 of 76 passed, on desktop and mobile. This includes the revocation, report-and-hide, password-reset and CSP journeys.
- CI on each PR runs migrations on a clean database. Locally they were applied on top of an already seeded database.

## Decisions taken

These are conservative defaults that the owner can reverse.

- **Coach roles**
  - Re-granting a coach role does not restore old assignments.
  - A revoked coach keeps reading their own past messages but cannot send new ones.
  - Feedback assigned to them goes back to the unassigned queue with its status unchanged.
- **Messaging**
  - Runners can start conversations only with their active coach or mentor.
  - They can reply to a manager or admin who wrote first.
  - Otherwise they reach the programme team through Feedback.
- **Moderators and the audit log**
  - Moderators are programme managers and admins.
  - The audit log is readable by admins only.
  - A moderator cannot decide a report they filed or one about themselves.
- **Rate limits:** see the table in #11.
- **CSP:** the full policy is report-only, and only a baseline is enforced. Enforcing the full policy needs nonces or SRI for Next.js inline scripts.
- **Demo seed:** fails closed everywhere and is never available on Vercel.

## Known limitations

- **Hidden messages:** the text stays readable through the raw Data API by the two people in the conversation. The app no longer sends it.
- **Reports:** profile and display-name reports are deferred to the Release 1 social features.
- **Password reset:** response timing may differ for existing and unknown addresses, because Supabase sends the email inside the request.
- **Vercel Preview:** deployments currently report `supabaseConfigured: false`, so signed-in flows can't be checked on previews.

## Owner actions

### GitHub repository settings

1. **Production environment.** Go to Settings → Environments → `production` and set:
   - **Required reviewers:** add yourself.
   - **Prevent self-review:** off, so you can approve your own runs.
   - **Allow administrators to bypass configured protection rules:** off.
   - **Deployment branches and tags:** Selected branches, rule `main`.
2. **Protect `main`.** Go to Settings → Rules → Rulesets → New branch ruleset, targeting the default branch, and enable:
   - Require a pull request before merging.
   - Require status checks to pass: "Lint, typecheck, unit tests, build, e2e".
   - Block force pushes.
   - Restrict deletions.
   - Optionally, allow only merge commits.
3. **Stacked PRs.** Either enable "Automatically delete head branches", or change the bases of #7 and #11 to `main` after their parents merge.

### Supabase

4. **Auth redirect URLs.** In Authentication → URL Configuration, keep the Site URL `https://hydrunners.vercel.app` and add the redirect URL `https://hydrunners.vercel.app/auth/callback**`. Password reset needs this.
5. **Custom SMTP.** Configure it before relying on reset emails.

### Vercel

6. **Remove `DEMO_SEED_TOKEN`** from Production if it is set; it is no longer used there.
7. **Optional:** give Preview the publishable Supabase variables, as the README describes.

## Merge and production sequence

Each step needs separate owner approval.

1. Merge #10 (CI) so that later PRs run the integration suites.
2. Merge #8 (headers) and #9 (password reset), in either order. Neither has a migration.
3. Merge #6. Run the preview workflow, review the dry run, and approve. Then run the apply workflow (`20261109120000`).
4. Retarget and merge #7. Run preview, then apply (`20261109130000`).
5. Retarget and merge #11. Run preview, then apply (`20261109140000`).
6. After each apply, check `/api/v1/health` and sign in. Until its migration is applied, the app shows its "not available yet" states.
