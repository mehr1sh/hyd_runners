# Scheduler — owner: Planning

Timetable upload and extraction, availability review, deterministic weekly planning with optional AI, approval, persistence and missed-session rescheduling. UI: `/schedule`.

## Flow

```
upload (private `timetables` bucket, signed URL) ─▶ /process: byte sniffing ─▶ PDF text (unpdf) ─▶ rule parser
                                                                           └▶ image / scanned / partial ─▶ AI (if configured)
   ─▶ rows for review (unconfirmed) ─▶ runner corrects + ticks each row ─▶ PUT /availability (validated, file deleted)
   ─▶ POST /schedule/proposals: planWeek (deterministic) ─▶ optional AI rearrangement ─▶ validateSchedule
   ─▶ edits (re-validated on every change) ─▶ POST /schedule/plans (validated again, persisted)
   ─▶ POST /schedule/workouts/:id/reschedule (next valid slot or unchanged + reason)
```

## Layout

- `logic/` — pure TypeScript, no I/O: `availability.ts` (validation, free/busy maths), `timetable-text.ts` (parser), `upload-validation.ts`, `programme.ts` (recovery rules, session plan), `schedule.ts` (placement + explanations, `runScheduler` contract entry point), `validate-schedule.ts` (independent hard-constraint check), `edit.ts` (edits, rescheduling).
- `server/` — pipeline (`extraction.ts`, `pdf-text.ts`), AI orchestration (`planner.ts`), data access with the caller's RLS client (`data.ts`, `uploads.ts`), route plumbing (`api.ts`).
- `components/` — planner UI.
- AI provider: `src/lib/ai/gemini.ts` behind the provider-neutral `src/lib/ai/structured.ts`.

## Rules (hard constraints, never relaxed)

- Sessions only inside confirmed **free** blocks; busy blocks always win; unlisted time is never assumed free. "Fill gaps" is an explicit opt-in that creates unconfirmed rows.
- Blocks never cross midnight (enter overnight time as two rows). Overlapping blocks of the same kind are rejected; touching free blocks are one continuous period.
- Duration 10 min … runner's limit. One session per day. Count ≤ min(requested, level cap). Rest days and hard-day spacing per level (`RECOVERY_RULES`).
- Soft preferences (days, time of day, full duration) may be relaxed, always with an explanation and alternatives.
- AI output may only rearrange the app's own sessions; it is schema-validated, rule-validated and discarded on any failure.

## Parser conventions

Hours 1–7 without AM/PM are left empty (ambiguous). Hours 8–12 without AM/PM are read as written and flagged, unless the document uses 24-hour times elsewhere. One-off dates are flagged (only weekly blocks are stored). Grid layouts lose columns in PDF text, so days are not guessed.

## Environment

| Variable              | Required                       | Server only       | Default            | Purpose                                                |
| --------------------- | ------------------------------ | ----------------- | ------------------ | ------------------------------------------------------ |
| `AI_PROVIDER`         | no                             | yes               | `none`             | `gemini` enables AI; `none` is the kill switch         |
| `GEMINI_API_KEY`      | only with `AI_PROVIDER=gemini` | yes               | –                  | Gemini API key (header `x-goog-api-key`, never logged) |
| `GEMINI_MODEL`        | no                             | yes               | `gemini-3.8-flash` | Gemini model id                                        |
| `AI_DAILY_CALL_LIMIT` | no                             | yes               | `10`               | AI calls per runner per 24 h (`ai_calls` table)        |
| Supabase vars         | yes                            | see DEPLOYMENT.md | –                  | Auth, DB, Storage                                      |

Everything works without AI. Migration: `supabase/migrations/20261015090000_planning_scheduler.sql`.

## Tests

`pnpm test` (unit + evaluation), `pnpm db:test` (RLS), `pnpm test:e2e` (`schedule.spec.ts`), and the opt-in API integration suite — see the header of `tests/unit/scheduler/api.integration.test.ts`.
