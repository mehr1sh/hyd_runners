import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/features/dashboard/format";
import { reviewEnrollmentAction } from "../actions";
import type { EnrollmentRequest } from "../enrollment-requests";
import { ActionButton } from "./action-form";

export function EnrollmentRequestsPanel({
  requests,
  timezone,
  scope,
}: {
  requests: EnrollmentRequest[];
  timezone: string;
  scope: "assigned" | "all";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Programme requests</h2>
        </CardTitle>
        <CardDescription>
          {scope === "all"
            ? "Runners waiting for a place on a coach-led programme."
            : "Your runners waiting for a place on a coach-led programme."}{" "}
          Approving starts the programme for them straight away.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests are waiting.</p>
        ) : (
          <ul className="divide-y">
            {requests.map((request) => (
              <li
                key={request.id}
                aria-label={`${request.runnerName}: ${request.programmeTitle}`}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <p className="font-medium text-brand-navy">{request.runnerName}</p>
                  <p className="text-muted-foreground">
                    {request.programmeSlug ? (
                      <Link
                        href={`/programmes/${request.programmeSlug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {request.programmeTitle}
                      </Link>
                    ) : (
                      request.programmeTitle
                    )}{" "}
                    · asked {formatDateTime(request.requestedAt, timezone)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    action={reviewEnrollmentAction}
                    fields={{ enrollmentId: request.id, decision: "approve" }}
                    label="Approve"
                    pendingLabel="Approving…"
                    size="sm"
                  />
                  <ActionButton
                    action={reviewEnrollmentAction}
                    fields={{ enrollmentId: request.id, decision: "decline" }}
                    label="Decline"
                    pendingLabel="Declining…"
                    variant="outline"
                    size="sm"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
