import Link from "next/link";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeAuditMetadata } from "../logic/moderation";
import type { AuditEntry } from "../moderation";

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" });

/** Read-only view of the append-only audit log (admins only; enforced by RLS). */
export function AuditLogTable({
  entries,
  nextBefore,
  paged,
}: {
  entries: AuditEntry[];
  nextBefore: number | null;
  paged: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="max-w-full overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableCaption>
            Security-sensitive actions, newest first. Entries cannot be edited or deleted. Message content is never
            recorded.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Affected person</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No entries yet.
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">
                  <time dateTime={entry.occurredAt}>{when.format(new Date(entry.occurredAt))}</time>
                </TableCell>
                <TableCell>{entry.actorName}</TableCell>
                <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                <TableCell>{entry.subjectName ?? "—"}</TableCell>
                <TableCell className="max-w-md text-xs text-muted-foreground">
                  {describeAuditMetadata(entry.metadata) || entry.targetType}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-4 text-sm">
        {paged && (
          <Link href="/manager?tab=audit" className="underline underline-offset-2">
            Newest entries
          </Link>
        )}
        {nextBefore && (
          <Link href={`/manager?tab=audit&auditBefore=${nextBefore}`} className="underline underline-offset-2">
            Older entries
          </Link>
        )}
      </div>
    </div>
  );
}
