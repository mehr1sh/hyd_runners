# Running conditions: run now or later

`/conditions` (Explore → Conditions) shows the next 24 hours of running conditions for Hyderabad's city centre or any place in the locations directory, and answers "run now or later?". The same summary component will appear on the dashboard.

## Weather provider: MET Norway

| Provider                                      | Account                  | Commercial use                                                                                                | Status                                      |
| --------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| MET Norway Locationforecast 2.0 (`/complete`) | None                     | Allowed: NLOD 2.0 / CC BY 4.0, "Data from MET Norway" ([licence](https://api.met.no/doc/License))             | **Used**                                    |
| Open-Meteo                                    | None (free tier)         | **Not allowed** on the free tier ("only … non-commercial purposes", [terms](https://open-meteo.com/en/terms)) | Rejected                                    |
| OpenWeatherMap, WeatherAPI.com                | Sign-up and key          | Stated as allowed, with attribution                                                                           | Not used (needs an account; owner decision) |
| Google Air Quality, IQAir                     | Billing / commercial ban | Google needs billing; IQAir's free plan bans commercial use                                                   | Rejected                                    |

The MET Norway response for Hyderabad was checked on 2026-11-09. It contains about 60 hourly entries with temperature, apparent temperature, humidity, dew point, wind, clear-sky UV and hourly precipitation, but **no precipitation probability**.

Terms we follow (`src/features/conditions/providers.ts`):

- An identifying `User-Agent` is sent (`hyd-runners/1.0 (+https://hydrunners.vercel.app; github.com/mehr1sh/hyd_runners)`).
- Coordinates are rounded to 2 decimals, within the 4-decimal limit, which keeps requests cacheable.
- No request is repeated before the response's `Expires` time. Later requests send `If-Modified-Since`. Requests are made server-side only and time out after 6 seconds. If one fails, the page says the forecast is unavailable and **never substitutes other data**.
- Every view shows "Data from MET Norway" with a link to the licence.

## Sample provider (tests and offline development)

`CONDITIONS_PROVIDER=sample` uses a fixed sample day. Playwright's web server sets it, so tests never call live weather. Sample data is labelled everywhere it appears: a "Sample data" badge and "Sample data for testing. Not live weather." No other value is accepted. Production uses MET Norway.

`LIVE_WEATHER=1 pnpm exec vitest run tests/unit/conditions/live.test.ts` makes one real request, as an opt-in check. CI never runs it.

## Air quality: awaiting a decision

No source with hourly Hyderabad air quality allows commercial use **without an account**. The options, each needing the owner to create an account or accept terms:

- **data.gov.in (CPCB)**: a free API key, hourly station readings including Hyderabad. The licence (GODL-India) reportedly allows commercial use with attribution; check the wording. These are readings, not forecasts.
- **OpenAQ**: free registration, readings only, attribution required.
- **WeatherAPI.com**: a free key, commercial use stated, limited air-quality data, attribution required.

Until one is chosen, `airQualityStatus()` returns `not_configured`. The page then says air quality isn't included, and **AQI is never estimated**. The score already handles AQI (deductions above 100, "avoid" above 200), so adding a provider means implementing `HourConditions.aqi`.

## The running score

Each hour starts at 100. Every deduction is shown to the runner as a reason (`src/features/conditions/logic.ts`):

| Factor                                | Effect                      |
| ------------------------------------- | --------------------------- |
| Feels-like > 26 / 29 / 33 °C          | −12 / −30 / −50             |
| Feels-like > 38 °C                    | Avoid                       |
| Dew point ≥ 20 / 24 °C                | −8 / −20                    |
| Rain ≥ 0.2 / 1 mm in the hour         | −10 / −30                   |
| Rain ≥ 4 mm                           | Avoid                       |
| Wind ≥ 9 m/s                          | −15                         |
| Wind ≥ 14 m/s                         | Avoid                       |
| Clear-sky UV ≥ 6 / 8 (daylight only)  | −10 / −20                   |
| AQI > 100 / 150 (when configured)     | −20 / −40                   |
| AQI > 200                             | Avoid                       |
| Dark (before sunrise or after sunset) | −5, with "pick a lit route" |

Levels: good ≥ 75, fair ≥ 50, poor below 50. "Avoid" overrides the score. Feels-like comes from MET's apparent temperature, or the NOAA heat index when that is missing. Sunrise and sunset are calculated locally with the NOAA approximation.

**Recommendation.** The app looks at the next 12 hours, but only 05:00–21:59 local time:

- **Go now** when the current hour is good and nothing later is at least 15 points better.
- **Better at HH:MM** when a later hour is at least fair and at least 15 points better.
- **Go now (fair)** when now is fair and nothing clearly improves.
- **No good window soon** otherwise.

The page states that this is a guide, not medical advice.
