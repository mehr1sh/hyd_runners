import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityImporter } from "@/features/activities/components/importer";
import { getRunnerContext } from "@/features/dashboard/context";
import { RunnerPreviewNotice } from "@/features/dashboard/preview-notice";

export const metadata: Metadata = { title: "Import an activity" };

export default async function ImportActivityPage() {
  const ctx = await getRunnerContext();
  const header = (
    <PageHeader
      title="Import an activity"
      description="GPX or FIT files from Garmin, Coros, Polar, Suunto, Strava exports and phone apps."
    />
  );
  if (!ctx)
    return (
      <>
        {header}
        <RunnerPreviewNotice feature="activity import" />
      </>
    );
  return (
    <>
      {header}
      <div className="max-w-xl">
        <ActivityImporter />
      </div>
    </>
  );
}
