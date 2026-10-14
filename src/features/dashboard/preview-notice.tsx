import { PlaceholderNotice } from "@/components/shared/placeholder-notice";

/** Shown by runner pages when the app runs without Supabase (preview mode). */
export function RunnerPreviewNotice({ feature }: { feature: string }) {
  return (
    <PlaceholderNotice feature={feature}>
      Connect Supabase (see README → Local setup) to see your real workouts, rewards and progress.
    </PlaceholderNotice>
  );
}
