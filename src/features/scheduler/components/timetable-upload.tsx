"use client";

import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileText, Loader2, Lock, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { TimetableUpload as UploadRecord } from "@/lib/contracts";
import { checkDeclaredFile, MAX_TIMETABLE_BYTES } from "../logic/upload-validation";
import type { AvailabilityDraft } from "../logic/types";
import { callApi, uploadWithProgress } from "./api-client";

type Processed = {
  upload: UploadRecord;
  method: "text_parser" | "ai";
  completeness: "complete" | "partial";
  drafts: AvailabilityDraft[];
  notes: string[];
};

type State =
  | { step: "idle" }
  | { step: "selected"; file: File }
  | { step: "invalid"; file: File | null; message: string }
  | { step: "uploading"; file: File; percent: number }
  | { step: "upload_failed"; file: File; message: string }
  | { step: "processing"; file: File; uploadId: string }
  | { step: "processing_failed"; file: File; uploadId: string; message: string; retryable: boolean }
  | { step: "extracted"; file: File; result: Processed };

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

/**
 * Upload → process → hand rows to the review list. The file goes straight
 * to private Storage via a one-time signed URL; the server checks the real
 * bytes before reading them. Extracted rows are never saved from here.
 */
export function TimetableUpload({
  aiConfigured,
  onExtracted,
}: {
  aiConfigured: boolean;
  onExtracted: (drafts: AvailabilityDraft[], uploadId: string) => void;
}) {
  const [state, setState] = useState<State>({ step: "idle" });
  const input = useRef<HTMLInputElement>(null);

  const choose = (file: File | undefined) => {
    if (!file) return;
    const rejection = checkDeclaredFile(file);
    setState(rejection ? { step: "invalid", file, message: rejection.message } : { step: "selected", file });
  };

  const process = async (file: File, uploadId: string) => {
    setState({ step: "processing", file, uploadId });
    const r = await callApi<Processed>(`/api/v1/timetables/${uploadId}/process`, { method: "POST" });
    if (!r.ok) {
      const details = r.error.details as { retryable?: boolean } | undefined;
      setState({
        step: "processing_failed",
        file,
        uploadId,
        message: r.error.message,
        retryable: details?.retryable ?? r.error.code === "internal_error",
      });
      return;
    }
    setState({ step: "extracted", file, result: r.data });
    onExtracted(r.data.drafts, uploadId);
  };

  const upload = async (file: File) => {
    setState({ step: "uploading", file, percent: 0 });
    const r = await callApi<{ upload: UploadRecord; uploadUrl: string }>("/api/v1/timetables", {
      method: "POST",
      body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }),
    });
    if (!r.ok) {
      if (r.error.code === "unsupported_media_type" || r.error.code === "payload_too_large") {
        setState({ step: "invalid", file, message: r.error.message });
      } else {
        setState({ step: "upload_failed", file, message: r.error.message });
      }
      return;
    }
    try {
      await uploadWithProgress(r.data.uploadUrl, file, (percent) => setState({ step: "uploading", file, percent }));
    } catch {
      setState({
        step: "upload_failed",
        file,
        message: "The upload did not finish. Check your connection and try again.",
      });
      return;
    }
    await process(file, r.data.upload.id);
  };

  const reset = () => {
    setState({ step: "idle" });
    if (input.current) input.current.value = "";
  };

  return (
    <section aria-labelledby="upload-heading" className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 id="upload-heading" className="text-lg font-semibold text-brand-navy">
          Upload a timetable (optional)
        </h2>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          PDF, PNG, JPG or WebP up to {MAX_TIMETABLE_BYTES / 1024 / 1024} MB. Files are stored privately and deleted
          once you confirm your times. You check everything we read before it is used.
        </p>
        {!aiConfigured && (
          <p className="mt-1 text-sm text-muted-foreground">
            Photos and scanned PDFs need the AI reader, which is not set up here. PDFs with selectable text still work,
            and you can always enter times by hand.
          </p>
        )}
      </div>

      <input
        ref={input}
        id="timetable-file"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => choose(e.target.files?.[0])}
      />

      <div aria-live="polite" className="space-y-3">
        {state.step === "idle" && (
          <Button variant="outline" onClick={() => input.current?.click()}>
            <Upload aria-hidden /> Choose a file
          </Button>
        )}

        {state.step !== "idle" && state.file && (
          <p className="flex min-w-0 items-center gap-2 text-sm text-brand-navy">
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{state.file.name}</span>
            <span className="shrink-0 text-muted-foreground">({(state.file.size / 1024).toFixed(0)} KB)</span>
          </p>
        )}

        {state.step === "selected" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => upload(state.file)}>
              <Upload aria-hidden /> Upload and read
            </Button>
            <Button variant="ghost" onClick={reset}>
              <X aria-hidden /> Choose another
            </Button>
          </div>
        )}

        {state.step === "invalid" && (
          <Status tone="error" text={state.message}>
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              Choose another file
            </Button>
          </Status>
        )}

        {state.step === "uploading" && (
          <div className="space-y-1">
            <Progress value={state.percent} aria-label={`Uploading: ${state.percent}%`} className="h-2" />
            <p className="text-sm text-muted-foreground">Uploading… {state.percent}%</p>
          </div>
        )}

        {state.step === "upload_failed" && (
          <Status tone="error" text={state.message}>
            <Button variant="outline" size="sm" onClick={() => upload(state.file)}>
              <RotateCcw aria-hidden /> Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
          </Status>
        )}

        {state.step === "processing" && (
          <p className="flex items-center gap-2 text-sm text-brand-navy">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Reading your timetable…
          </p>
        )}

        {state.step === "processing_failed" && (
          <Status tone="error" text={state.message}>
            {state.retryable && (
              <Button variant="outline" size="sm" onClick={() => process(state.file, state.uploadId)}>
                <RotateCcw aria-hidden /> Try again
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={reset}>
              Upload a different file
            </Button>
          </Status>
        )}

        {state.step === "extracted" && (
          <Status
            tone={state.result.completeness === "complete" ? "success" : "warning"}
            text={
              state.result.completeness === "complete"
                ? `Read ${state.result.drafts.length} row${state.result.drafts.length === 1 ? "" : "s"}. Check each one below.`
                : `Read ${state.result.drafts.length} row${state.result.drafts.length === 1 ? "" : "s"}, but some details are missing or uncertain. Fix the highlighted rows below and add anything that was missed.`
            }
          >
            {state.result.notes.length > 0 && (
              <ul className="w-full list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {state.result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <Button variant="ghost" size="sm" onClick={reset}>
              Upload another
            </Button>
          </Status>
        )}
      </div>
    </section>
  );
}

function Status({
  tone,
  text,
  children,
}: {
  tone: "error" | "warning" | "success";
  text: string;
  children?: React.ReactNode;
}) {
  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex flex-wrap items-start gap-2 rounded-lg border bg-background p-3 text-sm"
    >
      <Icon
        className={
          tone === "error"
            ? "mt-0.5 size-4 shrink-0 text-destructive"
            : tone === "success"
              ? "mt-0.5 size-4 shrink-0 text-success"
              : "mt-0.5 size-4 shrink-0 text-brand-red-strong"
        }
        aria-hidden
      />
      <p className={tone === "error" ? "flex-1 text-destructive" : "flex-1 text-brand-navy"}>{text}</p>
      {children && <div className="flex w-full flex-wrap gap-2">{children}</div>}
    </div>
  );
}
