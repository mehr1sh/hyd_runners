import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CoachMessage } from "../queries";

const SOURCE_LABEL = {
  deterministic: "Calculated from your data",
  ai_assisted: "Phrased with AI from the facts below",
  safety: "Safety guidance",
} as const;

export function CoachMessageView({ message, latest }: { message: CoachMessage; latest: boolean }) {
  if (message.role === "runner")
    return (
      <li
        className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand-navy px-4 py-2 text-sm text-white"
        id={latest ? "latest" : undefined}
      >
        {message.body}
      </li>
    );
  const p = message.payload;
  return (
    <li
      className="max-w-[95%] space-y-3 rounded-2xl rounded-bl-sm border bg-card p-4"
      id={latest ? "latest" : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">HYD Coach</span>
        {message.source && <Badge variant="outline">{SOURCE_LABEL[message.source]}</Badge>}
        {p?.dataAsOf !== undefined && (
          <span>{p?.dataAsOf ? `Activities up to ${p.dataAsOf}` : "No recent activities"}</span>
        )}
      </div>
      <div className="space-y-2 text-sm leading-relaxed">
        {message.body.split(/\n{2,}/).map((para, i) => (
          <p key={i} className="whitespace-pre-line">
            {para}
          </p>
        ))}
      </div>
      {p?.recommendation && (
        <p className="rounded-lg border-l-4 border-success bg-muted/40 px-3 py-2 text-sm">
          <span className="font-semibold">Suggestion: </span>
          {p.recommendation}
        </p>
      )}
      {p && p.basis.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">What this is based on ({p.basis.length})</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            {p.basis.map((f) => (
              <div key={f.id} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd>
                  {f.href ? (
                    <Link href={f.href} className="underline underline-offset-4">
                      {f.value}
                    </Link>
                  ) : (
                    f.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {p && p.missing.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Missing information</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {p.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {p?.uncertainty && <p className="text-xs text-muted-foreground">Uncertainty: {p.uncertainty}</p>}
      {p?.aiNote && <p className="text-xs text-muted-foreground">{p.aiNote}</p>}
      {p && p.links.length > 0 && (
        <p className="flex flex-wrap gap-3 text-sm">
          {p.links.map((l) => (
            <Link key={l.href} href={l.href} className="underline underline-offset-4">
              {l.label}
            </Link>
          ))}
        </p>
      )}
    </li>
  );
}
