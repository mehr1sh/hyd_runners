# Technical decisions

Status: **approved** on 14 Oct 2026. This file is the source of truth for the stack. The longer research and comparison write-up is in the team's "HYD Runners — Technical Stack Decision" doc; where the two differ, this file wins.

Changing anything here needs a PR labelled `decision`, approved by the lead.

## 1. Summary

HYD Runners is **one Next.js application** (App Router, TypeScript), deployed on **Vercel**, with **Supabase** providing PostgreSQL, Auth and private Storage. All privileged work runs on the server: timetable processing, AI calls, secret-key database access. Row Level Security (RLS) protects every table. AI features use a server-side LLM with Zod schema validation and always have a deterministic fallback. The scheduling algorithm is plain TypeScript and does not depend on any LLM provider.

## 2. Approved stack and pinned versions

Versions were current stable releases on 14 Oct 2026, checked with `npm view`. They are pinned in `package.json` and `pnpm-lock.yaml`. Only the lead upgrades them.

| Concern                                       | Choice                                                                             | Version                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Runtime                                       | Node.js                                                                            | 22 LTS or newer (`engines: >=22`); Vercel runs 22.x/24.x |
| Package manager                               | pnpm                                                                               | 11.5.2 (`packageManager` field)                          |
| Framework                                     | Next.js (App Router, Turbopack)                                                    | 16.4.0                                                   |
| UI runtime                                    | React / React DOM                                                                  | 19.3.0                                                   |
| Language                                      | TypeScript (strict)                                                                | 5.9.3 (TS 7.0 is not adopted until Next.js supports it)  |
| Styling                                       | Tailwind CSS (+ `@tailwindcss/turbopack`)                                          | 4.3.3                                                    |
| Components                                    | shadcn/ui (`radix-nova` style, Radix primitives), `cn`, `class-variance-authority` | shadcn 4.21.4, radix-ui 1.8.1                            |
| Icons                                         | lucide-react                                                                       | 1.56.0                                                   |
| Database / Auth / Storage                     | Supabase (`@supabase/supabase-js`, `@supabase/ssr`)                                | 2.117.3 / 0.12.7                                         |
| Supabase CLI (migrations, local stack, pgTAP) | `supabase` (dev dependency)                                                        | 2.120.0                                                  |
| Local Postgres                                | Supabase Postgres                                                                  | 17                                                       |
| Validation                                    | Zod                                                                                | 4.6.7                                                    |
| Forms                                         | react-hook-form + @hookform/resolvers                                              | 7.90.0 / 5.9.1                                           |
| Dates                                         | date-fns + @date-fns/tz                                                            | 4.4.0 / 1.5.0                                            |
| Charts                                        | Recharts                                                                           | 3.10.1                                                   |
| Maps                                          | Leaflet + react-leaflet                                                            | 1.9.4 / 5.0.0                                            |
| AI SDK                                        | @anthropic-ai/sdk (server only)                                                    | 0.133.0                                                  |
| PDF text (fallback path)                      | unpdf                                                                              | 1.8.1                                                    |
| Toasts                                        | sonner                                                                             | 2.0.8                                                    |
| Unit tests                                    | Vitest + Testing Library + jsdom                                                   | 5.0.4 / 16.3.3 / 30.1.2                                  |
| End-to-end tests                              | Playwright                                                                         | 1.64.0                                                   |
| Lint / format                                 | ESLint (eslint-config-next) / Prettier (+ tailwind plugin)                         | 9.39 / 3.9.10                                            |
| Hosting                                       | Vercel (web + API), Supabase Cloud (data)                                          | n/a                                                      |

## 3. Architecture rules

1. **Single app, feature folders.** There is no monorepo. Each feature lives in `src/features/<feature>/` and exposes what other code needs from that folder. The folders map to later packages if the mobile app needs them.
2. **Server-only secrets.** `src/lib/env.server.ts`, `src/lib/supabase/admin.ts` and `src/lib/ai/` import `server-only`, so the build fails if client code imports them. Only `NEXT_PUBLIC_*` values reach the browser.
3. **RLS is the security boundary.** Every table in `public` has RLS enabled, and grants start from nothing. Role checks use `private.has_role()` / `private.is_staff()`, which are security-definer functions in the `private` schema that the API does not expose. The proxy redirect and page guards are only conveniences for the user.
4. **Secret-key access is the exception.** `createAdminClient()` bypasses RLS. Use it only for jobs no single user may do themselves, such as AI processing, cron work and XP awards, and always filter by user id explicitly.
5. **Contracts first.** Shared entities are Zod schemas in `src/lib/contracts/index.ts` (see `docs/CONTRACTS.md`). Postgres enums mirror the contract enums.
6. **API for every client.** Data endpoints live under `/api/v1/*`, return the `{ data } | { error }` envelope, and accept either the web cookie session or `Authorization: Bearer <access_token>` (`getRequestUser`). The future Expo app uses the same endpoints and the same Supabase project.
7. **AI is optional.** `getAiProvider()` returns `null` when `AI_PROVIDER=none` or no key is set, and every AI feature must then fall back to a deterministic path. Extractors return the `ExtractedTimetable` contract. The scheduler takes `SchedulerInput` and returns `SchedulerResult`, and never imports an SDK.
8. **Uploads bypass functions.** Files go from the browser straight to the private Supabase Storage bucket under `{userId}/…`, which avoids Vercel's 4.5 MB function body limit. The server then processes them by storage path.
9. **No extra infrastructure** (Celery, Redis, queues, microservices, FastAPI) unless a measured requirement shows it is needed. Background work uses Postgres (`pg_cron`) or a status column first.

## 4. Specific decisions

| Decision                 | Choice                                                                                                              | Reason                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js Cache Components | **Off** (`cacheComponents: false`)                                                                                  | With it on, every session read needs its own `<Suspense>` boundary, which is too much friction for the first release. Revisit before Next.js 17, where it becomes the default.       |
| Session refresh          | `src/proxy.ts` (Next 16 replaces `middleware.ts`) calling `supabase.auth.getClaims()`                               | Supabase's recommended SSR pattern. Never trust `getSession()` on the server.                                                                                                        |
| Supabase keys            | New `sb_publishable_…` / `sb_secret_…` keys                                                                         | Legacy `anon` / `service_role` keys are deprecated by the end of 2026.                                                                                                               |
| Roles                    | `user_roles` table + `private.has_role()` in policies                                                               | Simple and testable. A JWT custom-claims hook can be added later for performance.                                                                                                    |
| Map                      | Leaflet with raster tiles from `NEXT_PUBLIC_MAP_TILE_URL`                                                           | Default is OpenStreetMap standard tiles with attribution, for light demo use only. Before real traffic, switch to a provider that allows production use; only the env value changes. |
| Map markers              | `CircleMarker` in brand red                                                                                         | Avoids Leaflet's bundler icon-path issues.                                                                                                                                           |
| LLM                      | Claude Haiku 5.5 (`claude-haiku-5-5`) via structured outputs + Zod, behind `src/lib/ai`                             | Native PDF and image input, low cost. The provider can be swapped behind the interface.                                                                                              |
| Dates                    | UTC `timestamptz` for instants; local `HH:mm` + ISO weekday for recurring availability; default zone `Asia/Kolkata` | India has no DST, so wall-clock maths is safe.                                                                                                                                       |
| Region                   | Supabase `ap-south-1` (Mumbai); Vercel function region `bom1`                                                       | Keeps the database round trip short for Hyderabad users.                                                                                                                             |
| Dark mode                | Not in scope for the first release                                                                                  | Light theme only. Tokens are centralised so dark mode can be added later.                                                                                                            |

## 5. Mobile path

The Expo app will reuse the Supabase project (Auth, RLS and Storage policies apply unchanged), call `/api/v1/*` with a bearer token, and import the contracts. When it starts, `src/lib/contracts` and the pure scheduling and gamification logic move into a shared package. That move is the only restructuring planned.
