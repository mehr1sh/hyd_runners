"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, CircleAlert, Info, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AvailabilityBlock } from "@/lib/contracts";
import { applyEdit } from "../logic/edit";
import { dateForWeekday, fromMinutes, instantToLocal } from "../logic/time";
import type {
  AvailabilityDraft,
  AvailabilityIssue,
  PlannerSettings,
  ProposedSession,
  ScheduleViolation,
  WeeklyProposal,
} from "../logic/types";
import type { StoredPlan } from "../server/data";
import { callApi } from "./api-client";
import { AvailabilityEditor } from "./availability-editor";
import { PlannerSettingsForm, toSettings, type SettingsDraft } from "./planner-settings-form";
import { TimetableUpload } from "./timetable-upload";
import { SessionDialog, WeekView, type SessionDraft, type WeekViewSession } from "./week-view";

type AiInfo = { status: string; message: string | null };

export type PlannerInitialData = {
  availability: AvailabilityBlock[];
  weeks: Array<{ weekStart: string; label: string }>;
  plans: Record<string, StoredPlan | null>;
  latestSettings: PlannerSettings | null;
  profileFitnessLevel: PlannerSettings["fitnessLevel"] | null;
  aiConfigured: boolean;
  timezone: string;
};

const blockToDraft = (b: AvailabilityBlock): AvailabilityDraft => ({
  key: b.id,
  weekday: b.weekday,
  startTime: b.startTime,
  endTime: b.endTime,
  kind: b.kind,
  label: b.label,
  source: b.source,
  confidence: b.confidence,
  uncertainties: [],
  rawText: null,
  confirmed: true,
});

function dayLabels(weekStart: string) {
  const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return [1, 2, 3, 4, 5, 6, 7].map((d) => fmt.format(new Date(`${dateForWeekday(weekStart, d)}T00:00:00Z`)));
}

type DialogState = { mode: "edit" | "add"; key: string | null; initial: SessionDraft; violations: ScheduleViolation[] };

/**
 * The planning flow: availability (upload or manual) → confirmed and saved →
 * settings → proposal → edit / regenerate / reject → approve → persisted
 * week with missed-session rescheduling. Proposals live only in this
 * component until approved.
 */
export function SchedulePlanner({ initial }: { initial: PlannerInitialData }) {
  const [tab, setTab] = useState(initial.availability.length === 0 ? "availability" : "plan");

  // Availability
  const [saved, setSaved] = useState<AvailabilityBlock[]>(initial.availability);
  const [drafts, setDrafts] = useState<AvailabilityDraft[]>(initial.availability.map(blockToDraft));
  const [dirty, setDirty] = useState(false);
  const [sourceUploadId, setSourceUploadId] = useState<string | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [serverIssues, setServerIssues] = useState<AvailabilityIssue[] | null>(null);

  // Planning
  const [settings, setSettings] = useState<SettingsDraft>(
    initial.latestSettings ?? {
      goal: null,
      fitnessLevel: initial.profileFitnessLevel,
      sessionsPerWeek: 3,
      maxSessionMinutes: 30,
      preferredDays: [],
      preferredTimesOfDay: [],
      programmeWeek: 1,
    },
  );
  const [useAi, setUseAi] = useState(initial.aiConfigured);
  const [weekStart, setWeekStart] = useState(initial.weeks[0].weekStart);
  const [plans, setPlans] = useState(initial.plans);
  const [proposal, setProposal] = useState<WeeklyProposal | null>(null);
  const [unplaced, setUnplaced] = useState<Array<{ title: string; reason: string }>>([]);
  const [ai, setAi] = useState<AiInfo | null>(null);
  const [rejected, setRejected] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<{ message: string; violations: ScheduleViolation[] } | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);

  const approved = plans[weekStart] ?? null;
  const validSettings = toSettings(settings);
  const labels = useMemo(() => dayLabels(weekStart), [weekStart]);
  const hasFree = saved.some((b) => b.kind === "free");

  const updateDrafts = (next: AvailabilityDraft[]) => {
    setDrafts(next);
    setDirty(true);
    setServerIssues(null);
  };

  const saveAvailability = async () => {
    setSavingAvailability(true);
    const r = await callApi<{ availability: AvailabilityBlock[]; warnings: AvailabilityIssue[] }>(
      "/api/v1/availability",
      {
        method: "PUT",
        body: JSON.stringify({ drafts, sourceUploadId }),
      },
    );
    setSavingAvailability(false);
    if (!r.ok) {
      const issues = (r.error.details as { issues?: AvailabilityIssue[] } | undefined)?.issues;
      if (issues) setServerIssues(issues);
      toast.error(r.error.message);
      return;
    }
    setSaved(r.data.availability);
    setDrafts(r.data.availability.map(blockToDraft));
    setDirty(false);
    setSourceUploadId(null);
    toast.success("Availability saved.");
    if (r.data.availability.some((b) => b.kind === "free")) setTab("plan");
  };

  const generate = async () => {
    if (!validSettings) return;
    setGenerating(true);
    setGenerateError(null);
    setApproveError(null);
    const r = await callApi<{ proposal: WeeklyProposal; unplaced: typeof unplaced; ai: AiInfo }>(
      "/api/v1/schedule/proposals",
      { method: "POST", body: JSON.stringify({ weekStart, settings: validSettings, useAi }) },
    );
    setGenerating(false);
    if (!r.ok) {
      setGenerateError(r.error.message);
      return;
    }
    setProposal(r.data.proposal);
    setUnplaced(r.data.unplaced);
    setAi(r.data.ai);
    setRejected(false);
    setReplaceConfirmed(false);
  };

  const editCtx = proposal ? { availability: saved, settings: proposal.settings } : null;

  const applySessionDraft = (draft: SessionDraft) => {
    if (!proposal || !editCtx || !dialog) return;
    const result =
      dialog.mode === "edit" && dialog.key
        ? applyEdit(proposal.sessions, { kind: "update", key: dialog.key, patch: draft }, editCtx)
        : applyEdit(
            proposal.sessions,
            {
              kind: "add",
              session: { ...draft, key: crypto.randomUUID(), rationale: [], plannedBy: "runner" } as ProposedSession,
            },
            editCtx,
          );
    if (!result.ok) {
      setDialog({ ...dialog, violations: result.violations });
      return;
    }
    const days = new Set(result.sessions.map((s) => s.weekday));
    setProposal({
      ...proposal,
      sessions: result.sessions,
      restDays: [1, 2, 3, 4, 5, 6, 7].filter((d) => !days.has(d)),
    });
    setDialog(null);
    setApproveError(null);
  };

  const removeSession = (s: WeekViewSession) => {
    if (!proposal || !editCtx) return;
    const result = applyEdit(proposal.sessions, { kind: "remove", key: s.key }, editCtx);
    if (result.ok) {
      const days = new Set(result.sessions.map((x) => x.weekday));
      setProposal({
        ...proposal,
        sessions: result.sessions,
        restDays: [1, 2, 3, 4, 5, 6, 7].filter((d) => !days.has(d)),
      });
    }
  };

  const approve = async () => {
    if (!proposal) return;
    setApproving(true);
    setApproveError(null);
    const r = await callApi<StoredPlan>("/api/v1/schedule/plans", {
      method: "POST",
      body: JSON.stringify({
        weekStart: proposal.weekStart,
        settings: proposal.settings,
        sessions: proposal.sessions,
        source: proposal.source,
        replaceExisting: Boolean(approved) && replaceConfirmed,
      }),
    });
    setApproving(false);
    if (!r.ok) {
      const violations = (r.error.details as { violations?: ScheduleViolation[] } | undefined)?.violations ?? [];
      setApproveError({ message: r.error.message, violations });
      return;
    }
    setPlans({ ...plans, [proposal.weekStart]: r.data });
    setProposal(null);
    setAi(null);
    toast.success("Plan approved and saved.");
    setTab("week");
  };

  const reschedule = async (s: WeekViewSession) => {
    if (!s.id || !approved) return;
    setRescheduling(s.key);
    const r = await callApi<StoredPlan>(`/api/v1/schedule/workouts/${s.id}/reschedule`, { method: "POST" });
    setRescheduling(null);
    if (!r.ok) {
      toast.error(r.error.message, { duration: 8000 });
      return;
    }
    setPlans({ ...plans, [approved.weekStart]: r.data });
    toast.success("Session moved to the next free slot.");
  };

  const approvedSessions: WeekViewSession[] = useMemo(() => {
    if (!approved) return [];
    return approved.workouts.map((w) => {
      const local = instantToLocal(w.startsAt, approved.timezone);
      return {
        key: w.id,
        id: w.id,
        weekday: local.weekday,
        startTime: fromMinutes(local.minutes),
        durationMinutes: w.durationMinutes,
        workoutType: w.workoutType === "rest" ? "mobility" : w.workoutType,
        title: w.title,
        rationale: w.rationale,
        plannedBy: w.plannedBy === "coach" ? "runner" : w.plannedBy,
        status: w.status,
      };
    });
  }, [approved]);

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="w-full sm:w-auto">
        <TabsTrigger value="availability">1. Availability</TabsTrigger>
        <TabsTrigger value="plan">2. Plan</TabsTrigger>
        <TabsTrigger value="week">3. Approved week</TabsTrigger>
      </TabsList>

      <TabsContent value="availability" className="space-y-6 pt-4">
        <TimetableUpload
          aiConfigured={initial.aiConfigured}
          onExtracted={(rows, uploadId) => {
            updateDrafts([...drafts, ...rows]);
            setSourceUploadId(uploadId);
          }}
        />
        <AvailabilityEditor
          drafts={drafts}
          onChange={updateDrafts}
          onSave={saveAvailability}
          saving={savingAvailability}
          serverIssues={serverIssues}
        />
      </TabsContent>

      <TabsContent value="plan" className="space-y-6 pt-4">
        {(!hasFree || dirty) && (
          <Notice tone="warning">
            {dirty
              ? "You have unsaved changes to your times. Save them on the Availability step before planning."
              : "Add and save some free time on the Availability step first."}
            <Button size="sm" variant="outline" onClick={() => setTab("availability")}>
              Go to availability
            </Button>
          </Notice>
        )}

        <PlannerSettingsForm value={settings} onChange={setSettings} />

        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-brand-navy">
              Plan for
              <select
                className="mt-1 block h-10 w-full rounded-lg border border-input bg-background px-2"
                value={weekStart}
                onChange={(e) => {
                  setWeekStart(e.target.value);
                  setProposal(null);
                }}
              >
                {initial.weeks.map((w) => (
                  <option key={w.weekStart} value={w.weekStart}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-10 items-center gap-2 self-end text-sm text-brand-navy">
              <input
                type="checkbox"
                className="size-4 accent-brand-navy"
                checked={useAi && initial.aiConfigured}
                disabled={!initial.aiConfigured}
                onChange={(e) => setUseAi(e.target.checked)}
              />
              {initial.aiConfigured
                ? "Ask AI to fine-tune the plan"
                : "AI suggestions are not set up; the standard planner is used"}
            </label>
          </div>
          <Button onClick={generate} disabled={!validSettings || !hasFree || dirty || generating}>
            <RefreshCw aria-hidden className={generating ? "animate-spin motion-reduce:animate-none" : undefined} />
            {generating ? "Planning…" : proposal ? "Regenerate" : "Generate plan"}
          </Button>
        </div>
        {!validSettings && (
          <p className="text-sm text-muted-foreground">Choose a goal and your experience to generate a plan.</p>
        )}
        {generateError && <Notice tone="error">{generateError}</Notice>}

        {rejected && !proposal && (
          <Notice tone="info">Proposal discarded. Change your settings or times and generate a new one.</Notice>
        )}

        {proposal && (
          <section aria-labelledby="proposal-heading" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="proposal-heading" className="text-lg font-semibold text-brand-navy">
                Proposed week
              </h2>
              <Badge variant="outline">Not saved yet</Badge>
              {proposal.source === "ai_assisted" ? (
                <Badge variant="secondary">
                  <Sparkles aria-hidden /> AI-assisted, rule-checked
                </Badge>
              ) : (
                <Badge variant="secondary">Standard planner</Badge>
              )}
            </div>
            {ai?.message && <Notice tone="info">{ai.message}</Notice>}
            {approved && (
              <Notice tone="warning">
                You already have an approved plan for this week. Approving this proposal replaces it; completed sessions
                are kept.
              </Notice>
            )}
            {(proposal.warnings.length > 0 || proposal.unsatisfied.length > 0) && (
              <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
                <h3 className="font-semibold text-brand-navy">What could not be met</h3>
                <ul className="space-y-2">
                  {proposal.warnings.map((w) => (
                    <li key={w} className="flex gap-2 text-brand-navy">
                      <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {w}
                    </li>
                  ))}
                  {proposal.unsatisfied.map((u) => (
                    <li key={u.message} className="space-y-1">
                      <p className="flex gap-2 text-brand-navy">
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-brand-red-strong" aria-hidden /> {u.message}
                      </p>
                      {u.alternatives.length > 0 && (
                        <ul className="ml-6 list-disc text-muted-foreground">
                          {u.alternatives.map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <WeekView
              sessions={proposal.sessions}
              dates={labels}
              mode="proposal"
              onEdit={(s) =>
                setDialog({
                  mode: "edit",
                  key: s.key,
                  violations: [],
                  initial: {
                    weekday: s.weekday,
                    startTime: s.startTime,
                    durationMinutes: s.durationMinutes,
                    workoutType: s.workoutType,
                    title: s.title,
                  },
                })
              }
              onRemove={removeSession}
            />

            {approveError && (
              <Notice tone="error">
                <span>{approveError.message}</span>
                {approveError.violations.length > 0 && (
                  <ul className="w-full list-disc pl-5">
                    {approveError.violations.map((v, i) => (
                      <li key={`${v.code}-${i}`}>{v.message}</li>
                    ))}
                  </ul>
                )}
              </Notice>
            )}

            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              {approved && (
                <label className="flex min-h-10 items-center gap-2 text-sm text-brand-navy">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-navy"
                    checked={replaceConfirmed}
                    onChange={(e) => setReplaceConfirmed(e.target.checked)}
                  />
                  Replace my approved plan for this week
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={approve}
                  disabled={approving || proposal.sessions.length === 0 || (Boolean(approved) && !replaceConfirmed)}
                >
                  <CalendarCheck aria-hidden />{" "}
                  {approving ? "Saving…" : approved ? "Replace approved plan" : "Approve plan"}
                </Button>
                <Button
                  variant="outline"
                  disabled={proposal.sessions.length >= 7}
                  onClick={() => {
                    const free = proposal.restDays[0] ?? 1;
                    setDialog({
                      mode: "add",
                      key: null,
                      violations: [],
                      initial: {
                        weekday: free,
                        startTime: "06:00",
                        durationMinutes: Math.min(30, proposal.settings.maxSessionMinutes),
                        workoutType: "walk",
                        title: "Extra walk",
                      },
                    });
                  }}
                >
                  <Plus aria-hidden /> Add session
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setProposal(null);
                    setRejected(true);
                    setApproveError(null);
                  }}
                >
                  <X aria-hidden /> Reject proposal
                </Button>
              </div>
              {proposal.sessions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No sessions fit. Add more free time or change your settings, then regenerate.
                </p>
              )}
              {unplaced.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {unplaced.length} session{unplaced.length === 1 ? " was" : "s were"} left out to keep the plan valid.
                </p>
              )}
            </div>
          </section>
        )}

        {dialog && proposal && (
          <SessionDialog
            open
            title={dialog.mode === "edit" ? "Edit session" : "Add a session"}
            initial={dialog.initial}
            maxMinutes={proposal.settings.maxSessionMinutes}
            violations={dialog.violations}
            onSubmit={applySessionDraft}
            onOpenChange={(open) => !open && setDialog(null)}
          />
        )}
      </TabsContent>

      <TabsContent value="week" className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-brand-navy">
            <span className="sr-only">Show approved plan for</span>
            <select
              className="h-10 rounded-lg border border-input bg-background px-2"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
            >
              {initial.weeks.map((w) => (
                <option key={w.weekStart} value={w.weekStart}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          {approved && (
            <Badge variant="secondary">
              <CalendarCheck aria-hidden /> Approved {new Date(approved.approvedAt).toLocaleDateString("en-IN")}
            </Badge>
          )}
        </div>
        {approved ? (
          <WeekView
            sessions={approvedSessions}
            dates={labels}
            mode="approved"
            onReschedule={reschedule}
            busyKey={rescheduling}
          />
        ) : (
          <Notice tone="info">
            No approved plan for this week yet.
            <Button size="sm" variant="outline" onClick={() => setTab("plan")}>
              Plan this week
            </Button>
          </Notice>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Notice({ tone, children }: { tone: "info" | "warning" | "error"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "flex flex-wrap items-center gap-2 rounded-lg border border-destructive bg-card p-3 text-sm text-destructive"
          : "flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm text-brand-navy"
      }
    >
      {tone === "error" ? (
        <CircleAlert className="size-4 shrink-0" aria-hidden />
      ) : (
        <Info className="size-4 shrink-0" aria-hidden />
      )}
      {children}
    </div>
  );
}
