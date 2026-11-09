import type { Step, WorkoutDetails } from "../logic/workouts";

function StepLine({ s }: { s: Step }) {
  const work = s.meters ? `${s.meters} m` : s.minutes !== undefined ? `${Math.round(s.minutes * 10) / 10} min` : "";
  return (
    <li>
      <span className="font-medium">
        {s.label}
        {work ? `: ${s.reps ? `${s.reps} × ` : ""}${work}` : ""}
      </span>
      {s.recovery ? `, ${s.recovery} between` : ""}
      <span className="block text-muted-foreground">
        {s.effort}
        {s.pace ? ` · ${s.pace}` : ""}
      </span>
    </li>
  );
}

export function WorkoutSteps({ workout }: { workout: WorkoutDetails }) {
  return (
    <div className="space-y-1 text-sm">
      <ol className="space-y-1">
        <StepLine s={workout.warmup} />
        {workout.main.map((s, i) => (
          <StepLine key={i} s={s} />
        ))}
        <StepLine s={workout.cooldown} />
      </ol>
      <p className="text-muted-foreground">
        About {workout.totalMinutes} min · {workout.intensity}
      </p>
      {workout.notes.map((n) => (
        <p key={n} className="text-xs text-muted-foreground">
          {n}
        </p>
      ))}
    </div>
  );
}
