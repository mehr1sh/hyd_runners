/** A short, honest nudge based on recent activity. Never shames rest. */
export type MotivationInput = {
  totalWorkouts: number;
  workedOutToday: boolean;
  streak: { current: number; atRisk: boolean };
  restRecommended: boolean;
  weekActiveDays: number;
  weeklyGoalDays: number;
  nextSessionTitle: string | null;
};

export function motivationalMessage(m: MotivationInput): string {
  if (m.totalWorkouts === 0)
    return m.nextSessionTitle
      ? `Your first session is the hardest. Start with “${m.nextSessionTitle}” — walking breaks are part of the plan.`
      : "Your first session is the hardest. Pick a programme and start small.";
  if (m.restRecommended)
    return "You have trained on 6 of the last 7 days. Take a rest day — recovery is when fitness is built.";
  if (m.workedOutToday) return "Session done for today. Rest, hydrate and come back fresh.";
  if (m.streak.atRisk)
    return `One session today keeps your ${m.streak.current}-day habit going. Even a 15-minute walk counts.`;
  const left = m.weeklyGoalDays - m.weekActiveDays;
  if (left === 1) return "One more active day and you hit this week's goal.";
  if (left <= 0) return "Weekly goal met. Extra sessions are optional — easy movement or rest both count.";
  if (m.streak.current >= 7) return `${m.streak.current} days and counting. Consistency beats intensity.`;
  return m.nextSessionTitle
    ? `Up next: ${m.nextSessionTitle}.`
    : "A short session today is better than a perfect one tomorrow.";
}
