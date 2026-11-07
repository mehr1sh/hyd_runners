# Schedule planner — technical evaluation

_Measured 14 Oct 2026 on branch `feat/schedule-planner`. Machine: Intel i7-14700HX (28 threads), Linux, Node 22.14, local Supabase (Docker). AI provider: not configured (no key available); AI behaviour was measured with simulated provider responses only._

Reproduce: `EVAL_REPORT=1 pnpm exec vitest run tests/unit/scheduler/evaluation.test.ts`.

## Method and results

| Metric                       | Method                                                                                                                                                                                                                             | Result                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Availability-parsing success | 16 labelled text timetables: 10 clear, 6 ambiguous (no AM/PM, no day, grid layout, missing end, one-off date, 8–12 without AM/PM). Success = clear input parsed exactly and marked complete; ambiguous input flagged, not guessed. | Clear: **9/10** exact; 1 (`10.00-12.00`) flagged for review by design. Ambiguous: **6/6** flagged. Values presented as certain but wrong: **0**. |
| Valid schedule rate          | 1,000 seeded random scenarios (0–2 free windows/day, random busy blocks, random goal/level/frequency/limit/preferences). Each schedule checked by an **independent checker** in the test plus the app validator.                   | **1000/1000** valid                                                                                                                              |
| Scheduling conflicts         | Same-day or overlapping session pairs across all 1,000 schedules                                                                                                                                                                   | **0**                                                                                                                                            |
| Constraint violations        | Schedules breaking any hard constraint (free time, busy time, midnight, duration, count, rest days, consecutive hard days)                                                                                                         | **0**                                                                                                                                            |
| Unexplained shortfalls       | Scenarios placing fewer sessions than requested without a warning/unsatisfied explanation, or sessions without rationale                                                                                                           | 483 scenarios had shortfalls (2,999 of 3,964 requested sessions placed); **0** unexplained                                                       |
| Scheduling latency           | `planWeek` wall time, same 1,000 scenarios                                                                                                                                                                                         | p50 **0.27 ms**, p95 **3.1 ms**, max **37.6 ms**                                                                                                 |
| Processing latency           | Full pipeline on generated 1-page text PDFs, 20 runs each, no AI                                                                                                                                                                   | p50 **5.4 / 6.3 / 6.5 ms** for 5 / 20 / 60 rows; first run 185 ms (pdf.js cold start)                                                            |
| AI failure & fallback        | Simulated timeout, auth, rate limit, server, network, blocked, malformed, invalid output                                                                                                                                           | **8/8** detected, 1 call each, deterministic fallback returned, all fallback schedules valid                                                     |

Evaluation-design note: the first run reported 11/1000 "invalid" schedules. All 11 came from the generator producing overlapping free blocks (rejected at save time in the real flow) or from the checker not treating touching blocks as continuous. The generator and checker were corrected; the scheduler was not changed.

## Tested

- Unit (`pnpm test`): 90 tests — availability validation, parser, upload sniffing, scheduler cases A–G, edits, rescheduling, Gemini adapter error mapping, AI fallback (H, I), pipeline (E, F), evaluation.
- RLS (`pnpm db:test`): 18 planning assertions — own-row isolation, storage path ownership, one approved plan per week, cross-user reschedule refused.
- API integration (opt-in, real local Supabase): 9 tests — signed-URL upload, PDF processing, disguised files, confirmation, generation, conflicting edit rejected, approval, duplicate approval 409, retrieval, cross-user 404, rescheduling, AI auth failure and rule-breaking AI output fall back.
- E2E (Playwright, desktop + mobile): full UI flow; whole suite 38/38.

## Not verified / limitations

- **No real AI call was made** (no key during development). Gemini request format is implemented from the public REST API; verify with a real key before relying on image or scanned-PDF extraction.
- Image extraction works only with AI configured; otherwise the UI directs to manual entry.
- Parser handles line-based text; grid timetables lose columns in PDF text and need review.
- Recurring weekly blocks only (contract has no exceptions/dates). Consecutive-day rules are checked within one Mon–Sun week.
- HTTP endpoint latency on Vercel/Supabase Cloud not measured; measure with the same API calls against a preview deployment.
- Recovery rules are conservative product defaults, not medical guidance.

## Next priorities

1. Run extraction against real timetables with a Gemini key; record accuracy.
2. Lead review of the shared-file changes (AI provider choice, env).
3. Wire planned sessions into Training's dashboard / programme sessions once those tables exist.
