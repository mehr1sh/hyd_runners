/**
 * The app files every workout under the runner's local calendar day of its
 * start time. Completing a timer workout with more active time than has passed
 * moves the start back by that time, so a spec that starts and completes a
 * workout straight away can land on yesterday when it runs shortly after local
 * midnight (in CI: 18:30-19:00 UTC for the default Asia/Kolkata), or in last
 * week on a Monday. Specs that assert "today" or "this week" give the runner
 * this timezone so the local time is midday whenever they run.
 */
export function middayTimezone(now = new Date()): string {
  // UTC offset in hours (-12 to +11) that puts the local time between 12:00
  // and 13:00: 12 - hour, wrapped into that range.
  const offset = ((48 - now.getUTCHours()) % 24) - 12;
  if (offset === 0) return "Etc/UTC";
  // POSIX sign convention: Etc/GMT-5 is UTC+5.
  return `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
