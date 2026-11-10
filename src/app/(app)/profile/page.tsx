import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm } from "@/features/identity/components/profile-form";
import { FITNESS_LEVEL_LABEL, GOAL_LABEL, NEED_LABEL } from "@/features/identity/logic/onboarding";
import { loadOnboarding } from "@/features/identity/service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

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
  const record = user ? await loadOnboarding(await createClient(), user.id) : null;

  return (
    <>
      <PageHeader title="Profile and preferences" description="How you appear to others and how your plan is built." />
      <p className="mb-4 text-sm">
        <Link href="/profile/integrations" className="underline underline-offset-4">
          Connected apps and devices
        </Link>
      </p>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Roles come from the server. This form cannot change them.</CardDescription>
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
                  {user.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {ROLE_LABEL[role] ?? role}
                    </Badge>
                  ))}
                </dd>
                {record?.ok && record.data.fitnessLevel && (
                  <>
                    <dt className="text-muted-foreground">Experience</dt>
                    <dd className="font-medium text-brand-navy">{FITNESS_LEVEL_LABEL[record.data.fitnessLevel]}</dd>
                  </>
                )}
                {record?.ok && record.data.primaryNeed && (
                  <>
                    <dt className="text-muted-foreground">Focus</dt>
                    <dd className="font-medium text-brand-navy">{NEED_LABEL[record.data.primaryNeed]}</dd>
                  </>
                )}
                {record?.ok && record.data.preferences && (
                  <>
                    <dt className="text-muted-foreground">Goal</dt>
                    <dd className="font-medium text-brand-navy">{GOAL_LABEL[record.data.preferences.goal]}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Sign in to see your account details.</p>
            )}
          </CardContent>
        </Card>
        {record?.ok && <ProfileForm record={record.data} />}
        {record && !record.ok && <p className="text-sm text-destructive">{record.message}</p>}
      </div>
    </>
  );
}
