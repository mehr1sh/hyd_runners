import type { Metadata } from "next";
import { ProfileStyleForm } from "@/features/storytelling/components/forms";
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
  const style = user ? await loadStyle(user.id) : null;

  return (
    <>
      <PageHeader title="Profile and preferences" description="How you appear to others and how your plan is built." />
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
        {user && style && (
          <Card>
            <CardHeader>
              <CardTitle>Profile style</CardTitle>
              <CardDescription>
                How your runner profile looks to others. Only badges you&apos;ve earned can be showcased.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileStyleForm {...style} />
            </CardContent>
          </Card>
        )}
        {record && !record.ok && <p className="text-sm text-destructive">{record.message}</p>}
      </div>
    </>
  );
}

async function loadStyle(userId: string) {
  const supabase = await createClient();
  const [profile, badges, routes] = await Promise.all([
    supabase
      .from("profiles")
      .select("profile_theme, showcase_badges, favourite_route_ids, show_race_history")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_badges").select("badge_code, badges(title)").eq("user_id", userId),
    supabase.from("routes").select("id, name").eq("status", "published").order("name").limit(60),
  ]);
  if (!profile.data) return null;
  return {
    theme: profile.data.profile_theme as string,
    showcase: (profile.data.showcase_badges as string[]) ?? [],
    favourites: (profile.data.favourite_route_ids as string[]) ?? [],
    showRaces: Boolean(profile.data.show_race_history),
    earned: ((badges.data ?? []) as unknown as { badge_code: string; badges: { title: string } | null }[]).map((b) => ({
      code: b.badge_code,
      title: b.badges?.title ?? b.badge_code,
    })),
    routes: (routes.data ?? []) as { id: string; name: string }[],
  };
}
