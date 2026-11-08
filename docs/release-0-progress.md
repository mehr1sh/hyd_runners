# Release 0 progress

Release 0 covers security, infrastructure reliability and administrative foundations.

**Status: complete.** Release 0 was merged, migrated and verified in production on 2026-11-08. Later work is tracked in [implementation-roadmap.md](implementation-roadmap.md).

## Workstreams

| Workstream                                  | PR       | Merge commit         | Migration        | Status                                                     |
| ------------------------------------------- | -------- | -------------------- | ---------------- | ---------------------------------------------------------- |
| D. CI and workflow reliability              | #10      | `b3f41c3`            | none             | Production verified                                        |
| C. Security headers and demo-seed hardening | #8       | `249fd95`            | none             | Production verified                                        |
| F. Password reset                           | #9       | `8e27d8a`            | none             | Deployed. Production email is limited until SMTP is set up |
| A. Coach and message access                 | #6       | `4285049`            | `20261109120000` | Production verified                                        |
| Schema verification workflow                | #13, #14 | `52bcd53`, `79f5cf5` | none             | In use                                                     |
| B. Reports, moderation and audit log        | #7       | `3721ddf`            | `20261109130000` | Production verified                                        |
| E. Rate limits, row cap and correctness     | #11      | `613a9d7`            | `20261109140000` | Production verified                                        |
| G. Deployment protection                    | settings | none                 | none             | Configured                                                 |

## Production migrations

Each migration had a dry run listing it as the only pending migration. It was then applied from the same `main` commit and checked by the read-only schema verification workflow.

| Migration                                 | Dry run     | Apply       | Verify       |
| ----------------------------------------- | ----------- | ----------- | ------------ |
| `20261109120000_coach_and_message_access` | 42496463846 | 42496536565 | 42497129178* |
| `20261109130000_moderation_and_audit_log` | 42497742338 | 42497819478 | 42497916758  |
| `20261109140000_limits_and_correctness`   | 42498543731 | 42498611978 | 42498687758  |

\* The first verification run failed. It found one difference, `public.rls_auto_enable()`, which belongs to Supabase's automatic-RLS setting and not to our migrations. PR #14 allows that object by name. Everything else matched, and later runs report no drift.

## How production was verified

- **Schema:** after every migration, the production `public` and `private` schemas match the schema built from `supabase/migrations`. The pgTAP and integration suites test that same schema in CI. Those suites cover:
  - message privacy;
  - revoked and unassigned coaches;
  - report and audit-log access;
  - append-only audit entries;
  - concurrent rate limits.
- **Health:** `/api/v1/health` returns `supabaseConfigured: true` after each step.
- **Demo seed:** `POST /api/v1/dev/seed-demo` returns 404 on production, with or without a token.
- **Headers:** the security headers, enforced CSP baseline and report-only CSP are all served.
- **Password reset:**
  - `/forgot-password` and `/reset-password` render.
  - An invalid callback code redirects to `/forgot-password?error=link_invalid`.
  - The Auth redirect allow-list includes `https://hydrunners.vercel.app/**`, so no change was needed.
- **Not done in production:** no live signed-in tests were run. There is no production test account, and creating one would add a fake user. The access rules are verified at the database level as described above.

## GitHub protection, configured 2026-11-08

- **Ruleset "Protect main"** (active, no bypass actors):
  - pull request required;
  - CI check "Lint, typecheck, unit tests, build, e2e" required;
  - merge commits only;
  - force pushes and branch deletion blocked.
- **`production` environment:**
  - deployments only from `main`;
  - administrators cannot bypass the rules;
  - no required reviewers, so the authorised migration workflow can run without manual approval.
- **Auto-delete of merged branches:** enabled, so GitHub retargets stacked PRs.

## Remaining owner actions

- **Custom SMTP.** Production uses Supabase's built-in sender, which has no `smtp_host` and is limited to 2 emails an hour.
  - Configure a provider under Supabase → Authentication → SMTP: host, port, user, password, sender address and name.
  - Then raise the email rate limit.
- **Vercel Production.** Remove `DEMO_SEED_TOKEN` if it is set. It is ignored there now, so this is cleanup only.
- **Vercel Preview.** Previews report `supabaseConfigured: false`. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to Preview if previews should show signed-in pages.

## Known limitations

- **Hidden messages:** the text stays readable through the raw Data API by the two people in the conversation. The app does not send it.
- **CSP:** the full policy is report-only until Next.js inline scripts can use nonces or SRI.
- **Password-reset timing:** response timing may differ between existing and unknown addresses.
