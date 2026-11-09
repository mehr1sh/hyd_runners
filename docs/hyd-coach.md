# HYD Coach

HYD Coach answers questions about a runner's own training. Every answer is calculated from the runner's data first. An AI model may then rephrase it, but it never decides the facts.

## How a question is answered

1. **Intent.** `detectIntent()` (`src/features/hyd-coach/logic/intent.ts`) maps the question to one intent with fixed rules. The intents are progress, pace drop, consistency, best effort, routes, mileage increase, next four weeks, today, race, month comparison, recovery and overview.
2. **Safety first.** Questions that mention pain, injury or worrying symptoms (chest pain, dizziness, fainting and similar) get a fixed reply. It recommends a doctor or physiotherapist, and urgent help for red-flag symptoms. These questions are never sent to an AI provider.
3. **Retrieval.** `loadCoachData()` (`server/context.ts`) loads the caller's data with their own Supabase session, so RLS restricts every query to their rows:
   - 13 weeks of weekly totals (`my_weekly_series`);
   - run and walk-run activities from the last 120 days;
   - GPS best efforts (`my_best_efforts`);
   - planned sessions for the next 14 days and adherence over the last 28;
   - training preferences.

   The forecast is loaded only for questions about today. No other runner's data, no staff data and no service-role key is involved.

4. **Calculation.** `answerQuestion()` (`logic/compose.ts`) computes the numbers and writes the answer. Every number it uses is registered as a **fact** (id, label, value and an optional link to the activity). The answer also lists **missing information** and states the **uncertainty**.
5. **Optional phrasing.** The AI step runs only if all of these hold:
   - `AI_PROVIDER` is configured;
   - the runner is under `AI_DAILY_CALL_LIMIT`, which is shared with the planner's AI features;
   - the answer has at least one fact.

   The model then receives only a fact sheet: the question, `id | label | value` lines, the missing data and the draft. It gets no names, places, GPS, activity ids or free text from the database.

   Its reply is validated with Zod and is **discarded** if any of these fail:
   - every number in it must appear in the question, draft or facts;
   - it may cite only known fact ids;
   - it must not contain diagnosis or injury-risk language.

   If the model fails, times out or is rejected, the deterministic answer is shown.

## What the runner sees

- The answer, an optional **Suggestion**, and **What this is based on**: the facts, with links to the activities behind them.
- **Missing information** and **Uncertainty**.
- A source label: _Calculated from your data_, _Phrased with AI from the facts below_ or _Safety guidance_.
- Data freshness: the date of the newest activity the answer could see.

## Limits and costs

- 60 questions per hour and 30 new conversations per day per runner, enforced in the database (`PT429`).
- Phrasing calls are capped at 600 output tokens, use one attempt and a 25-second timeout. They count towards `AI_DAILY_CALL_LIMIT`.
- Each call is recorded in `ai_calls` with feature `hyd_coach`, outcome, error kind, latency, model and token counts. AI phrasing is used only if an AI provider is already configured, and turning it on adds no new account or spending.
- Previous turns are not sent to the model. Each question is answered from fresh data.

## Privacy and retention

- `coach_conversations` and `coach_messages` are owner-only under RLS. Other runners, assigned human coaches and admins cannot read them; pgTAP covers each of these.
- Messages cannot be edited. A runner can delete a conversation at any time, and its messages are deleted with it.
- **Retention:** a conversation is deleted 180 days after its last message. `purge_my_stale_coach_conversations()` runs each time the runner opens HYD Coach. For runners who never come back, `private.purge_stale_coach_conversations()` is available to the service role for a scheduled sweep; no schedule has been set up yet.

## Not covered

- HYD Coach does not diagnose, prescribe treatment or estimate injury risk. "10% a week" style guidance is presented as a rule of thumb.
- Activities are not linked to saved routes, so route questions only group runs the runner gave the same name. Each activity page has a same-route comparison.
- Recovery and race-goal context are added by Release 3 workstreams B and C.
