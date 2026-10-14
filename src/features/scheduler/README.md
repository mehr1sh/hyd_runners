# Scheduler — owner: Planning (Developer A)

Scope: timetable upload to the private `timetables` bucket, extraction (Claude via `src/lib/ai` + unpdf/rules fallback + manual grid), review screen, `availability_blocks`, and the scheduling algorithm.

Rules:

- The algorithm is a pure function `SchedulerInput → SchedulerResult` in `logic/`, with no Supabase and no LLM imports. Unit-test it.
- Any extractor returns `ExtractedTimetable`. Nothing is saved until the runner confirms the review screen.
- Add the Anthropic adapter in `src/lib/ai/anthropic.ts` and wire it in `getAiProvider()` (lead review).
