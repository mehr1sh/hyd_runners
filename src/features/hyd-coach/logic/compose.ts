import { formatDuration, formatPace } from "@/features/events/logic";
import { addDays, daysBetween, monthStart, type LocalDate } from "@/features/gamification/logic/time";
import { PR_DISTANCES } from "@/features/activities/logic/normalize";
import { predictRaces, RACE_DISTANCES } from "@/features/training/logic/predict";
import { detectIntent, mentionedDistance, type Intent } from "./intent";
import type { CoachAnswer, CoachData, Fact, RecentRun } from "./types";

/**
 * Deterministic answers. Every number in an answer is computed here from
 * CoachData and listed in `basis`, so the reply can be checked against the
 * data it came from. When data is thin the answer says so instead of guessing.
 */

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const pace = (s: number) => `${formatPace(Math.round(s))} /km`;
const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

type Window = { runs: number; distanceM: number; movingS: number; pace: number | null; avgDistanceM: number | null };

export function windowStats(runs: RecentRun[], from: LocalDate, to: LocalDate): Window {
  const inWin = runs.filter((r) => r.localDate >= from && r.localDate <= to);
  const paced = inWin.filter((r) => r.avgPaceS !== null && r.distanceM >= 1000);
  const pd = paced.reduce((s, r) => s + r.distanceM, 0);
  const pm = paced.reduce((s, r) => s + r.movingS, 0);
  const distanceM = inWin.reduce((s, r) => s + r.distanceM, 0);
  return {
    runs: inWin.length,
    distanceM,
    movingS: inWin.reduce((s, r) => s + r.movingS, 0),
    pace: paced.length >= 3 && pd > 0 ? pm / (pd / 1000) : null,
    avgDistanceM: inWin.length ? distanceM / inWin.length : null,
  };
}

/** Longest run of days without a run/walk-run inside [from, to]. */
export function longestGapDays(runs: RecentRun[], from: LocalDate, to: LocalDate) {
  const dates = [...new Set(runs.map((r) => r.localDate))].filter((d) => d >= from && d <= to).sort();
  if (dates.length === 0) return daysBetween(from, to) + 1;
  let gap = daysBetween(from, dates[0]);
  for (let i = 1; i < dates.length; i++) gap = Math.max(gap, daysBetween(dates[i - 1], dates[i]) - 1);
  return Math.max(gap, daysBetween(dates[dates.length - 1], to));
}

class Builder {
  basis: Fact[] = [];
  missing: string[] = [];
  links: { href: string; label: string }[] = [];
  fact(id: string, label: string, value: string, href?: string) {
    if (!this.basis.some((f) => f.id === id)) this.basis.push({ id, label, value, ...(href ? { href } : {}) });
    return value;
  }
  link(href: string, label: string) {
    if (!this.links.some((l) => l.href === href)) this.links.push({ href, label });
  }
}

const NO_RUNS =
  "No run or walk-run activities in the last 120 days. Import a GPX or FIT file to get answers based on your running.";

export function answerQuestion(question: string, data: CoachData): CoachAnswer {
  const intent = detectIntent(question);
  if (intent === "safety") return safetyAnswer(data);
  const b = new Builder();
  const body = COMPOSERS[intent](data, b, question);
  return {
    intent,
    text: body.text,
    recommendation: body.recommendation ?? null,
    basis: b.basis,
    missing: b.missing,
    uncertainty: body.uncertainty ?? null,
    links: b.links,
    dataAsOf: data.runs[0]?.localDate ?? null,
  };
}

export function safetyAnswer(data: CoachData): CoachAnswer {
  return {
    intent: "safety",
    text:
      "I can't assess pain, injuries or symptoms, and I won't guess at a cause. Please stop or ease off running on it and speak to a doctor or physiotherapist.\n\n" +
      "Get urgent medical help straight away for chest pain, fainting, severe breathlessness or sudden severe pain.\n\n" +
      "Once a professional has assessed you, I can help you fit their advice into your plan, for example by easing your schedule.",
    recommendation: "Pause hard training and get a professional assessment.",
    basis: [],
    missing: [],
    uncertainty: null,
    links: [{ href: "/schedule", label: "Adjust your schedule" }],
    dataAsOf: data.runs[0]?.localDate ?? null,
  };
}

type Body = { text: string; recommendation?: string | null; uncertainty?: string | null };
type Composer = (d: CoachData, b: Builder, q: string) => Body;

const COMPOSERS: Record<Exclude<Intent, "safety">, Composer> = {
  progress(d, b) {
    if (d.runs.length === 0) return none(b);
    const recent = windowStats(d.runs, addDays(d.today, -41), d.today);
    const prior = windowStats(d.runs, addDays(d.today, -83), addDays(d.today, -42));
    b.link("/performance", "Performance Lab");
    if (recent.pace === null || prior.pace === null) {
      b.missing.push("At least three runs of 1 km or more in each of the last two six-week periods.");
      b.fact("runs_6w", "Runs in the last 6 weeks", String(recent.runs));
      b.fact("runs_prev_6w", "Runs in the 6 weeks before", String(prior.runs));
      return {
        text: `I can't compare your pace fairly yet: you have ${recent.runs} runs in the last six weeks and ${prior.runs} in the six weeks before, and I need at least three with pace in each.`,
        uncertainty: "Not enough data for a comparison.",
      };
    }
    const rp = b.fact("pace_6w", "Average pace, last 6 weeks", pace(recent.pace));
    const pp = b.fact("pace_prev_6w", "Average pace, 6 weeks before", pace(prior.pace));
    b.fact("runs_6w", "Runs in the last 6 weeks", String(recent.runs));
    b.fact("runs_prev_6w", "Runs in the 6 weeks before", String(prior.runs));
    const diff = prior.pace - recent.pace;
    const lines: string[] = [];
    if (Math.abs(diff) < 5) lines.push(`Your average pace is about the same: ${rp} recently against ${pp} before.`);
    else if (diff > 0)
      lines.push(`Yes, on average. Your pace over the last six weeks is ${rp}, against ${pp} in the six weeks before.`);
    else
      lines.push(`Not on average. Your pace over the last six weeks is ${rp}, against ${pp} in the six weeks before.`);
    if (recent.avgDistanceM && prior.avgDistanceM) {
      const ra = b.fact("avg_dist_6w", "Average run distance, last 6 weeks", km(recent.avgDistanceM));
      const pa = b.fact("avg_dist_prev_6w", "Average run distance, 6 weeks before", km(prior.avgDistanceM));
      const change = recent.avgDistanceM / prior.avgDistanceM - 1;
      if (Math.abs(change) >= 0.15)
        lines.push(
          `Your runs were ${change > 0 ? "longer" : "shorter"} on average (${ra} against ${pa}), which by itself changes average pace, so this is not a like-for-like comparison.`,
        );
    }
    const newBests = d.efforts.filter((e) => e.startedAt >= `${addDays(d.today, -42)}`);
    if (newBests.length) {
      const names = newBests.map((e) => PR_DISTANCES.find((p) => p.key === e.key)?.label ?? e.key);
      b.fact("new_bests_6w", "Best efforts set in the last 6 weeks", names.join(", "));
      lines.push(`You set best efforts in the last six weeks for: ${names.join(", ")}.`);
    }
    return {
      text: lines.join("\n\n"),
      uncertainty: "Average pace mixes easy and hard runs, terrain and weather, so treat it as a rough signal.",
    };
  },

  pace_drop(d, b) {
    if (d.runs.length === 0) return none(b);
    const thisFrom = monthStart(d.today);
    const lastFrom = monthStart(addDays(thisFrom, -1));
    const cur = windowStats(d.runs, thisFrom, d.today);
    const prev = windowStats(d.runs, lastFrom, addDays(thisFrom, -1));
    b.link("/performance", "Performance Lab");
    if (cur.pace === null || prev.pace === null) {
      b.missing.push("At least three runs with pace this month and last month.");
      return {
        text: "I need at least three runs with pace in both this month and last month to compare them.",
        uncertainty: "Not enough data.",
      };
    }
    const cp = b.fact("pace_month", "Average pace this month", pace(cur.pace));
    const pp = b.fact("pace_last_month", "Average pace last month", pace(prev.pace));
    if (cur.pace <= prev.pace + 4)
      return { text: `Your pace hasn't dropped this month: ${cp} against ${pp} last month.` };
    const reasons: string[] = [];
    if (cur.avgDistanceM && prev.avgDistanceM && cur.avgDistanceM > prev.avgDistanceM * 1.15) {
      const a = b.fact("avg_dist_month", "Average run distance this month", km(cur.avgDistanceM));
      const p = b.fact("avg_dist_last_month", "Average run distance last month", km(prev.avgDistanceM));
      reasons.push(`Your runs are longer on average (${a} against ${p}); longer runs are usually slower.`);
    }
    const days = daysBetween(thisFrom, d.today) + 1;
    const curWeekly = (cur.distanceM / days) * 7;
    const prevDays = daysBetween(lastFrom, thisFrom);
    const prevWeekly = (prev.distanceM / prevDays) * 7;
    if (prevWeekly > 0 && curWeekly > prevWeekly * 1.2) {
      const c = b.fact("weekly_month", "Distance per week this month", km(curWeekly));
      const p = b.fact("weekly_last_month", "Distance per week last month", km(prevWeekly));
      reasons.push(`You are running more per week (${c} against ${p}), and tired legs run slower.`);
    }
    if (prevWeekly > 0 && curWeekly < prevWeekly * 0.75) {
      const c = b.fact("weekly_month", "Distance per week this month", km(curWeekly));
      const p = b.fact("weekly_last_month", "Distance per week last month", km(prevWeekly));
      reasons.push(`You are running less per week (${c} against ${p}), which can cost some fitness.`);
    }
    b.missing.push("Weather, effort and terrain for each run (not recorded), which often explain pace changes.");
    return {
      text:
        `Your average pace is ${cp} this month against ${pp} last month.\n\n` +
        (reasons.length
          ? `What your data shows that could explain it:\n${reasons.map((r) => `- ${r}`).join("\n")}`
          : "Your distance and run lengths are similar to last month, so the data doesn't point to an obvious reason."),
      uncertainty:
        "I can show what changed in your data, not prove why your pace changed. Heat and humidity in Hyderabad can slow runs a lot.",
    };
  },

  consistency(d, b) {
    const full = d.weeks.slice(0, -1);
    const active = full.filter((w) => w.runs > 0).length;
    const runs = full.reduce((s, w) => s + w.runs, 0);
    const a = b.fact("weeks_active_12", "Weeks with at least one run (last 12)", `${active} of ${full.length}`);
    const r = b.fact("runs_per_week_12", "Runs per week (last 12 weeks)", (runs / Math.max(full.length, 1)).toFixed(1));
    const gap = b.fact(
      "longest_gap_84",
      "Longest gap between runs (last 12 weeks)",
      `${longestGapDays(d.runs, addDays(d.today, -83), d.today)} days`,
    );
    const lines = [`You ran in ${a} weeks, averaging ${r} runs a week. Your longest break was ${gap}.`];
    const p = d.plan.past28;
    if (p.planned > 0) {
      const done = b.fact(
        "plan_done_28",
        "Planned sessions completed (last 28 days)",
        `${p.completed} of ${p.planned}`,
      );
      lines.push(`You completed ${done} planned sessions in the last four weeks.`);
    } else b.missing.push("A training schedule, to compare planned and completed sessions.");
    b.link("/performance", "Performance Lab");
    b.link("/schedule", "Schedule");
    const recommendation =
      active < 8
        ? "Pick two fixed days a week you can protect, and keep those runs short and easy until the habit sticks."
        : null;
    return { text: lines.join("\n\n"), recommendation };
  },

  best_effort(d, b, q) {
    const wanted = mentionedDistance(q);
    const efforts = d.efforts.filter((e) => !wanted || e.key === wanted);
    b.link("/performance", "Performance Lab");
    if (efforts.length === 0) {
      b.missing.push(wanted ? `A GPS run covering ${wanted.toUpperCase()}.` : "Runs with GPS splits.");
      return {
        text: wanted
          ? "I don't have a GPS best effort for that distance yet."
          : "I don't have any GPS best efforts yet.",
      };
    }
    const lines = efforts.map((e) => {
      const label = PR_DISTANCES.find((p) => p.key === e.key)?.label ?? e.key;
      const v = b.fact(
        `best_${e.key}`,
        `Best ${label}`,
        `${formatDuration(e.seconds)} on ${e.startedAt.slice(0, 10)}`,
        `/activities/${e.activityId}`,
      );
      return `- ${label}: ${v}`;
    });
    return {
      text: `Your fastest GPS segments:\n${lines.join("\n")}`,
      uncertainty:
        "These are the fastest stretches inside your recorded runs, measured by GPS. They are not official race results.",
    };
  },

  routes(d, b) {
    b.link("/performance", "Performance Lab");
    b.link("/routes", "Routes");
    const generic = /^(morning|afternoon|evening|night|lunch|early morning)?\s*(run|walk|jog|running)$/i;
    const groups = new Map<string, RecentRun[]>();
    for (const r of d.runs) {
      const name = r.name?.trim();
      if (!name || generic.test(name) || r.avgPaceS === null) continue;
      const k = name.toLowerCase();
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const repeated = [...groups.values()].filter((g) => g.length >= 2);
    b.missing.push("Activities are not linked to saved routes, so I can only group runs you gave the same name.");
    if (repeated.length === 0)
      return {
        text: "I can't tell which routes suit you yet. None of your recent runs share a name, and activities aren't linked to saved routes. Each activity page's same-route comparison shows how you did on matching tracks.",
      };
    const rows = repeated
      .map((g) => {
        const dist = g.reduce((s, r) => s + r.distanceM, 0);
        const mov = g.reduce((s, r) => s + r.movingS, 0);
        return { name: g[0].name!, n: g.length, pace: mov / (dist / 1000) };
      })
      .sort((x, y) => x.pace - y.pace)
      .slice(0, 5);
    const lines = rows.map(
      (r, i) => `- ${r.name}: ${b.fact(`route_${i}`, `${r.name} (${r.n} runs)`, pace(r.pace))} over ${r.n} runs`,
    );
    return {
      text: `Your fastest average pace on runs you named the same way:\n${lines.join("\n")}`,
      uncertainty:
        "Different routes have different hills, surfaces and traffic, so a faster route isn't necessarily a better one.",
    };
  },

  mileage_ramp(d, b) {
    const full = d.weeks.slice(0, -1);
    const last = full[full.length - 1];
    const prev4 = full.slice(-5, -1);
    const base = prev4.reduce((s, w) => s + w.distanceM, 0) / Math.max(prev4.length, 1);
    if (!last || base < 1000) {
      b.missing.push("At least four weeks of running before last week.");
      return {
        text: "There isn't enough running in the four weeks before last week to judge how quickly your distance has grown.",
      };
    }
    const l = b.fact("last_week_km", "Distance last week", km(last.distanceM));
    const avg = b.fact("prev4_avg_km", "Average weekly distance, the 4 weeks before", km(base));
    const change = last.distanceM / base - 1;
    const c = b.fact("week_change", "Change against that average", pct(change));
    const verdict =
      change > 0.3
        ? "That's a big jump. Many coaches suggest growing weekly distance gradually and following a bigger week with an easier one."
        : change > 0.1
          ? "That's a moderate increase. Keeping it there for a week or two before adding more is a sensible approach."
          : "That's a gradual change.";
    return {
      text: `You ran ${l} last week, against an average of ${avg} over the four weeks before (${c}).\n\n${verdict}`,
      recommendation: change > 0.3 ? "Hold or reduce your distance this week rather than adding more." : null,
      uncertainty:
        'Percentage rules such as "10% a week" are rules of thumb, not a measure of your injury risk. How you feel matters as much as the numbers.',
    };
  },

  next_weeks(d, b) {
    const full = d.weeks.slice(0, -1);
    const last4 = full.slice(-4);
    const base = last4.reduce((s, w) => s + w.distanceM, 0) / Math.max(last4.length, 1);
    const runsPerWeek = last4.reduce((s, w) => s + w.runs, 0) / Math.max(last4.length, 1);
    const sessions = Math.min(6, Math.max(2, d.prefs?.sessionsPerWeek ?? Math.round(runsPerWeek || 3)));
    b.link("/schedule", "Plan your week");
    b.link("/training", "Race preparation");
    if (base < 3000) {
      const v = b.fact("avg_week_4", "Average weekly distance, last 4 weeks", km(base));
      return {
        text: `You've averaged ${v} a week recently, so I'd build the habit first rather than the distance.\n\n- Weeks 1–2: ${sessions} sessions of 20–30 minutes, easy, walk breaks are fine.\n- Week 3: the same sessions, one of them 5–10 minutes longer.\n- Week 4: back to week 1 to absorb the work.`,
        recommendation: "Build consistency before distance.",
        uncertainty: "This is a general outline, not a personalised training prescription.",
      };
    }
    const v = b.fact("avg_week_4", "Average weekly distance, last 4 weeks", km(base));
    b.fact("sessions_week", "Sessions per week (your preference or recent average)", String(sessions));
    const weeks = [1.05, 1.1, 1.1, 0.85].map((f) => base * f);
    const quality = runsPerWeek >= 3 && full.filter((w) => w.runs > 0).length >= 8;
    const outline = weeks
      .map((w, i) => {
        const total = b.fact(`outline_w${i + 1}`, `Suggested distance, week ${i + 1}`, km(w));
        const long = b.fact(`outline_long_w${i + 1}`, `Suggested long run, week ${i + 1}`, km(w * 0.3));
        return `- Week ${i + 1}: about ${total} over ${sessions} runs, long run around ${long}${i === 3 ? " (easier week)" : quality ? ", one tempo or interval session" : ", all easy"}`;
      })
      .join("\n");
    if (d.raceGoal) {
      const race = RACE_DISTANCES.find((r) => r.key === d.raceGoal!.distance)!;
      b.fact("race_goal", "Race goal", `${race.label} on ${d.raceGoal.date}`);
    }
    return {
      text: `Starting from your recent ${v} a week:\n${outline}${quality ? "" : "\n\nI've kept every run easy because your recent running doesn't yet show three regular runs a week."}`,
      recommendation: d.raceGoal
        ? "Use race preparation to turn this into a dated plan you can approve."
        : "Add the sessions to your schedule and review them weekly.",
      uncertainty:
        "A recommendation from your recent volume only. It doesn't know about illness, work or how hard your runs felt.",
    };
  },

  today(d, b) {
    b.link("/schedule", "Schedule");
    b.link("/conditions", "Run conditions");
    const planned = d.plan.upcoming.find((p) => p.startsAt.slice(0, 10) === d.today);
    const lines: string[] = [];
    let recommendation: string;
    const recentDays = [...new Set(d.runs.map((r) => r.localDate))];
    let streak = 0;
    for (let day = d.today; recentDays.includes(day); day = addDays(day, -1)) streak++;
    if (streak === 0) for (let day = addDays(d.today, -1); recentDays.includes(day); day = addDays(day, -1)) streak++;
    const latestRecovery = d.recovery.find((r) => r.date >= addDays(d.today, -1));
    if (planned) {
      const p = b.fact("planned_today", "Planned for today", `${planned.title} (${planned.durationMinutes} min)`);
      lines.push(`Your schedule has ${p} today.`);
      recommendation = "Follow your plan, and swap it for an easy run if you feel unusually tired.";
    } else if (streak >= 3) {
      const s = b.fact("run_streak", "Consecutive days with a run", String(streak));
      lines.push(`You've run ${s} days in a row.`);
      recommendation = "Make today easy or a rest day.";
    } else {
      const last = d.runs[0];
      const sorted = d.runs.map((r) => r.distanceM).sort((x, y) => x - y);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      if (last && daysBetween(last.localDate, d.today) <= 1 && median > 0 && last.distanceM > median * 1.5) {
        const v = b.fact("last_run", "Your last run", `${km(last.distanceM)} on ${last.localDate}`);
        lines.push(`Your last run (${v}) was much longer than usual.`);
        recommendation = "Choose an easy run today.";
      } else {
        const full = d.weeks.slice(0, -1).slice(-4);
        const rpw = full.reduce((s, w) => s + w.runs, 0) / Math.max(full.length, 1);
        const v = b.fact("runs_per_week_4", "Runs per week, last 4 weeks", rpw.toFixed(1));
        if (rpw >= 3) {
          lines.push(`You've been running ${v} times a week, which is a reasonable base for one harder session.`);
          recommendation =
            "A short tempo session is reasonable if you feel fresh: warm up, 15–20 minutes comfortably hard, cool down.";
        } else {
          lines.push(
            `You've been running ${v} times a week, so easy running will do more for you than intensity right now.`,
          );
          recommendation = "An easy run.";
        }
      }
    }
    if (latestRecovery && (latestRecovery.fatigue ?? 0) >= 4) {
      b.fact("fatigue_recent", "Fatigue in your journal", `${latestRecovery.fatigue} of 5 on ${latestRecovery.date}`);
      lines.push("Your recovery journal says you're feeling tired, so keep it easy whatever you choose.");
      recommendation = "Easy run or rest.";
    }
    if (d.conditions) {
      const c = b.fact("conditions_now", `Conditions (${d.conditions.place})`, d.conditions.summary);
      lines.push(`Conditions: ${c}`);
      if (d.conditions.nowLevel === "poor" || d.conditions.nowLevel === "avoid")
        recommendation = `${recommendation} Conditions are poor right now, so keep the effort down or run later.`;
    } else b.missing.push("Current weather (the forecast could not be loaded).");
    return {
      text: lines.join("\n\n"),
      recommendation,
      uncertainty: "I can't tell how hard your recent runs felt; if you're tired or unwell, rest.",
    };
  },

  race(d, b, q) {
    b.link("/training", "Race preparation");
    const target = d.raceGoal?.distance ?? mentionedDistance(q);
    const preds = predictRaces(d.efforts, d.nowMs).filter((p) => !target || p.race === target);
    const lines: string[] = [];
    if (d.raceGoal) {
      const race = RACE_DISTANCES.find((r) => r.key === d.raceGoal!.distance)!;
      const days = daysBetween(d.today, d.raceGoal.date);
      const g = b.fact("race_goal", "Race goal", `${d.raceGoal.name ?? race.label} on ${d.raceGoal.date}`);
      const dl = b.fact("days_to_race", "Days to race", String(days));
      lines.push(`Your goal is ${g}, ${dl} days away.`);
      if (d.raceGoal.targetSeconds) {
        const t = b.fact("race_target", "Target time", formatDuration(d.raceGoal.targetSeconds));
        lines.push(`Your target is ${t}.`);
      }
    } else b.missing.push("A race goal (distance, date and optional target time).");
    for (const p of preds) {
      if (p.ok) {
        const v = b.fact(
          `predict_${p.race}`,
          `${p.label} estimate`,
          `${formatDuration(p.seconds)} (range ${formatDuration(p.low)}–${formatDuration(p.high)})`,
          `/activities/${p.basis.activityId}`,
        );
        const src = b.fact(
          `predict_${p.race}_basis`,
          `${p.label} estimate based on`,
          `best ${p.basis.key.toUpperCase()} effort on ${p.basis.startedAt.slice(0, 10)}`,
        );
        lines.push(`${p.label}: about ${v}, from your ${src}.`);
      } else lines.push(`${p.label}: ${p.reason}`);
    }
    const ok = preds.find((p) => p.ok && p.race === d.raceGoal?.distance);
    if (ok && ok.ok && d.raceGoal?.targetSeconds) {
      const gap = ok.seconds - d.raceGoal.targetSeconds;
      lines.push(
        gap <= 0
          ? "Your current estimate is at or ahead of your target."
          : `Your current estimate is ${b.fact("target_gap", "Gap to target", formatDuration(gap))} slower than your target.`,
      );
    }
    return {
      text: lines.join("\n\n"),
      uncertainty:
        "Estimates are not guaranteed finish times. They come from GPS segments of training runs and assume you train for the distance.",
    };
  },

  month_compare(d, b) {
    if (d.runs.length === 0) return none(b);
    const from = monthStart(d.today);
    const span = daysBetween(from, d.today);
    const prevFrom = monthStart(addDays(from, -1));
    const prevTo = addDays(prevFrom, span);
    const cur = windowStats(d.runs, from, d.today);
    const prev = windowStats(d.runs, prevFrom, prevTo < from ? prevTo : addDays(from, -1));
    const days = span + 1;
    const rows = [
      `- Distance: ${b.fact("dist_mtd", "Distance this month so far", km(cur.distanceM))} against ${b.fact("dist_prev_mtd", `Distance in the first ${days} days of last month`, km(prev.distanceM))}`,
      `- Runs: ${b.fact("runs_mtd", "Runs this month so far", String(cur.runs))} against ${b.fact("runs_prev_mtd", `Runs in the first ${days} days of last month`, String(prev.runs))}`,
    ];
    if (cur.pace !== null && prev.pace !== null)
      rows.push(
        `- Average pace: ${b.fact("pace_mtd", "Average pace this month", pace(cur.pace))} against ${b.fact("pace_prev_mtd", "Average pace, same days last month", pace(prev.pace))}`,
      );
    else b.missing.push("Three or more runs with pace in each period, for a pace comparison.");
    const better: string[] = [];
    if (cur.distanceM > prev.distanceM * 1.05) better.push("more distance");
    if (cur.runs > prev.runs) better.push("more runs");
    if (cur.pace !== null && prev.pace !== null && cur.pace < prev.pace - 4) better.push("a faster average pace");
    b.link("/performance", "Performance Lab");
    return {
      text: `Comparing the first ${days} days of this month with the same days last month:\n${rows.join("\n")}\n\n${better.length ? `You improved on ${better.join(", ")}.` : "No clear improvement on these measures yet this month."}`,
    };
  },

  recovery(d, b) {
    const week = d.recovery.filter((r) => r.date >= addDays(d.today, -6));
    const runDays = new Set(d.runs.filter((r) => r.localDate >= addDays(d.today, -6)).map((r) => r.localDate)).size;
    const rest = b.fact("rest_days_7", "Days without a run (last 7)", String(7 - runDays));
    const lines = [`You had ${rest} days without a run in the last week.`];
    if (week.length === 0) {
      b.missing.push("Recovery journal entries (sleep, fatigue, soreness) for the last 7 days.");
      lines.push("You haven't logged how you're feeling this week, so I can only go by your running.");
    } else {
      const avg = (k: "fatigue" | "soreness" | "sleepQuality") => {
        const v = week.map((r) => r[k]).filter((x): x is number => x !== null);
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      const f = avg("fatigue");
      const s = avg("soreness");
      const sl = avg("sleepQuality");
      if (f !== null)
        lines.push(`Average fatigue: ${b.fact("fatigue_7", "Average fatigue (1–5), last 7 days", f.toFixed(1))} of 5.`);
      if (s !== null)
        lines.push(
          `Average soreness: ${b.fact("soreness_7", "Average soreness (1–5), last 7 days", s.toFixed(1))} of 5.`,
        );
      if (sl !== null)
        lines.push(
          `Average sleep quality: ${b.fact("sleep_7", "Average sleep quality (1–5), last 7 days", sl.toFixed(1))} of 5.`,
        );
      if ((f ?? 0) >= 3.5 || (s ?? 0) >= 3.5)
        return {
          text: lines.join("\n\n"),
          recommendation: "Keep the next few days easy, and add a rest day if it doesn't improve.",
          uncertainty: "Based on your own ratings; this isn't a medical assessment.",
        };
    }
    return { text: lines.join("\n\n"), uncertainty: "This isn't a medical assessment." };
  },

  overview(d, b) {
    if (d.runs.length === 0) return none(b);
    const full = d.weeks.slice(0, -1).slice(-4);
    const dist = full.reduce((s, w) => s + w.distanceM, 0);
    const runs = full.reduce((s, w) => s + w.runs, 0);
    const v = b.fact("dist_4w", "Distance, last 4 full weeks", km(dist));
    const r = b.fact("runs_4w", "Runs, last 4 full weeks", String(runs));
    b.link("/performance", "Performance Lab");
    return {
      text: `In the last four full weeks you ran ${r} times for ${v}.\n\nI can answer questions about your pace, consistency, best efforts, weekly distance, race estimates and what to do today. Try one of the suggestions.`,
    };
  },
};

function none(b: Builder): Body {
  b.missing.push("Run or walk-run activities in the last 120 days.");
  b.link("/activities/import", "Import an activity");
  return { text: NO_RUNS, uncertainty: null };
}
