import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

export function AccessDenied({ area }: { area: string }) {
  return (
    <EmptyState
      icon={ShieldCheck}
      title={`${area} is for staff`}
      description="Your account does not have access to this area. Ask a programme manager if you think this is a mistake."
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to today</Link>
        </Button>
      }
    />
  );
}
