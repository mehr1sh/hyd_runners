import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { OnboardingWizard } from "@/features/identity/components/onboarding-form";
import { loadOnboarding } from "@/features/identity/service";
import { listLocations } from "@/features/community/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your plan" };

export default async function OnboardingPage() {
  const user = await getCurrentUser();

  return (
    <>
      <PageHeader
        title="Set up your plan"
        description="Tell us about your running, what gets in the way, and how you like to train. You can stop and continue later."
      />
      {!isSupabaseConfigured || !user ? (
        <p className="text-sm text-muted-foreground">Sign in to save your setup. Nothing is stored in preview mode.</p>
      ) : (
        <OnboardingLoader userId={user.id} />
      )}
    </>
  );
}

async function OnboardingLoader({ userId }: { userId: string }) {
  const supabase = await createClient();
  const [record, locations] = await Promise.all([loadOnboarding(supabase, userId), listLocations()]);
  if (!record.ok) {
    return <p className="text-sm text-destructive">{record.message}</p>;
  }
  return (
    <OnboardingWizard
      record={record.data}
      locations={locations.map((location) => ({ id: location.id, name: location.name, verified: location.verified }))}
    />
  );
}
