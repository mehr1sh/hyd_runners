import { formatDuration, formatPace } from "@/features/events/logic";

export const ACTIVITY_TYPE_LABEL = { run: "Run", walk_run: "Walk-run", walk: "Walk", hike: "Hike" } as const;
export const VISIBILITY_LABEL = {
  private: "Only me",
  followers: "Followers",
  public: "Everyone signed in",
} as const;

export const km = (m: number | null) => (m === null ? "—" : `${(m / 1000).toFixed(2)} km`);
export const pace = (s: number | null) => (s === null ? "—" : `${formatPace(s)} /km`);
export const duration = (s: number | null) => (s === null ? "—" : formatDuration(s));
