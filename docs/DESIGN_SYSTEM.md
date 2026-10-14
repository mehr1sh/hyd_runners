# Design system

HYD Runners should feel like a clean fitness product: readable, minimal, spacious and uncluttered. It should look like neither Strava nor Duolingo.

## Brand palette

Brand colours were sampled from `public/branding/hyd-runners-logo.png`, using the most common pixel values in the red and navy regions. The logo artwork itself is used unchanged: never recolour, crop or redraw it.

| Token                | Hex       | Source           | Use                                                                                    |
| -------------------- | --------- | ---------------- | -------------------------------------------------------------------------------------- |
| `--brand-red`        | `#E31E25` | Logo red         | Primary buttons (white text), active tab icons, progress fill, map pins, small accents |
| `--brand-red-strong` | `#C8161D` | Derived (darker) | Red **text** and links, primary button hover                                           |
| `--brand-red-soft`   | `#FDECEC` | Derived (tint)   | Rare highlight backgrounds (e.g. setup notice)                                         |
| `--brand-navy`       | `#2C335A` | Logo navy        | Body text, headings, selected navigation, focus ring                                   |
| `--brand-navy-soft`  | `#EEF0F6` | Derived (tint)   | Selected nav background, icon chips, secondary buttons                                 |
| `--surface`          | `#F7F7F5` | Neutral          | Page background (off-white)                                                            |
| `#FFFFFF`            | White     | Neutral          | Cards, header, dialogs                                                                 |
| `--muted-foreground` | `#5B6077` | Derived          | Secondary text                                                                         |
| `--input`            | `#8A8FA3` | Derived          | Form control borders                                                                   |
| `--border`           | `#E3E5EC` | Derived          | Decorative dividers only                                                               |
| `--destructive`      | `#B42318` | Derived          | Errors                                                                                 |
| `--success`          | `#1F7A4D` | Derived          | Success states                                                                         |

Tokens are defined once in `src/app/globals.css` and exposed to Tailwind as `bg-brand-red`, `text-brand-navy` and so on. Change a value here first, then in CSS.

## Contrast decisions (WCAG 2.2 AA)

Ratios were computed with the WCAG relative-luminance formula.

| Foreground                | Background           | Ratio           | Verdict                                                   |
| ------------------------- | -------------------- | --------------- | --------------------------------------------------------- |
| White text                | Brand red `#E31E25`  | 4.69:1          | Pass (normal text) → primary button                       |
| White text                | Red strong `#C8161D` | 5.85:1          | Pass → primary button hover                               |
| Brand red `#E31E25` text  | White                | 4.69:1          | Pass, but only on white                                   |
| Brand red `#E31E25` text  | Off-white `#F7F7F5`  | 4.37:1          | **Fail** for normal text → use `#C8161D` for all red text |
| Red strong `#C8161D` text | Off-white            | 5.46:1          | Pass                                                      |
| Navy `#2C335A` text       | White / off-white    | 12.15 / 11.33:1 | Pass (AAA)                                                |
| Muted `#5B6077` text      | White / off-white    | 6.21 / 5.78:1   | Pass                                                      |
| Input border `#8A8FA3`    | White                | 3.21:1          | Pass (non-text, 1.4.11)                                   |
| Border `#E3E5EC`          | White                | ~1.3:1          | Decorative only; never the sole indicator of a control    |
| Brand red                 | Navy                 | 2.59:1          | Never put red text on navy or navy text on red            |

**Rules that follow from this**

- Red **text** is always `text-brand-red-strong`. `bg-brand-red` and `text-brand-red` are for fills, icons and large accents.
- The primary button hover darkens to `#C8161D`. The default shadcn behaviour (`bg-primary/80`, which lightens) would drop below 4.5:1, so it was replaced.
- Focus indicator: a 2px navy ring with a 2px offset on every interactive element, replacing shadcn's 50%-opacity ring, which fails 3:1.
- Selected navigation: navy text on `--brand-navy-soft`, with a red indicator bar (sidebar) or red icon (mobile tab bar). State is never conveyed by colour alone, because `aria-current="page"` is also set.

## Usage of red

Red means **action or achievement**: the primary button on a screen (one per view where possible), the selected-state marker, streak and progress highlights, map pins. Do not use red for decoration, large backgrounds or more than one competing call to action.

## Typography and spacing

- Font: Geist Sans (via `next/font`), Geist Mono for codes and ids.
- Scale: page title `text-2xl` (`sm:text-3xl`), section `text-lg`/`text-base` semibold, body `text-sm`/`text-base`, helper `text-xs`.
- Headings use `text-brand-navy`; secondary copy uses `text-muted-foreground`.
- Spacing uses Tailwind's 4px grid: `gap-3`/`gap-4` inside cards, `space-y-6` between page sections, page gutters `px-4 sm:px-6`.
- Radius: `--radius` 10px; cards `rounded-xl`, buttons `rounded-lg`.
- Touch targets: buttons and inputs are at least 40px tall (`h-10`); mobile tab items are 56px.

## Components

shadcn/ui components live in `src/components/ui` (generated, lightly edited for contrast and size). Shared building blocks:

| Component                          | Path                                         | Use                                                  |
| ---------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `Logo`                             | `components/brand/logo.tsx`                  | Header and auth pages; links home                    |
| `PageHeader`                       | `components/shared/page-header.tsx`          | One per page: title, description, actions            |
| `EmptyState`                       | `components/shared/empty-state.tsx`          | No data yet, with one next action                    |
| `PlaceholderNotice`, `SampleBadge` | `components/shared/placeholder-notice.tsx`   | **Required** on any unfinished screen or sample data |
| `ProgressMeter`                    | `components/shared/progress-meter.tsx`       | Labelled progress ("2 of 3")                         |
| `WeeklyMinutesChart`               | `components/charts/weekly-minutes-chart.tsx` | Lightweight Recharts bar chart                       |
| `LocationMap`                      | `components/map/location-map.tsx`            | Leaflet map, client-only                             |
| `AccessDenied`                     | `components/shared/access-denied.tsx`        | Staff-only areas                                     |

## Navigation

- **Desktop (≥ 1024px):** left sidebar with runner destinations and a separate "Staff" group, shown only to staff roles.
- **Mobile:** a bottom tab bar with four primary destinations (Today, Schedule, Programmes, Workouts) and a "More" sheet for the rest.
- A skip link ("Skip to content") is the first focusable element.

## Placeholders and honesty

Unfinished areas must show `PlaceholderNotice`. Any sample number or chart must carry `SampleBadge` or say "sample" in its caption. Seeded locations are labelled "(sample)" and are unverified. Never present invented activity as a real runner's data.

## Avoid

Gradients, oversized hero sections, decorative statistics, excessive cards, heavy animation (the app respects `prefers-reduced-motion`), and dashboards crowded with widgets.
