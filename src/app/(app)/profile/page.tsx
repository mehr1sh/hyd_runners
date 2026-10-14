import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Profile" };

const ROLE_LABEL: Record<string, string> = {
  runner: "Runner",
  coach: "Coach",
  mentor: "Mentor",
  programme_manager: "Programme manager",
  admin: "Admin",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();

  return (
    <>
      <PageHeader title="Profile and preferences" description="How you appear to others and how your plan is built." />
      <div className="space-y-6">
        <PlaceholderNotice feature="profile editing and preferences" owner="Planning" />
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Details from your HYD Runners account.</CardDescription>
          </CardHeader>
          <CardContent>
            {user ? (
              <dl className="grid gap-4 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium text-brand-navy">{user.displayName}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-brand-navy">{user.email ?? "—"}</dd>
                <dt className="text-muted-foreground">Roles</dt>
                <dd className="flex flex-wrap gap-2">
                  {user.roles.map((r) => (
                    <Badge key={r} variant="secondary">
                      {ROLE_LABEL[r] ?? r}
                    </Badge>
                  ))}
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Sign in to see your account details.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
