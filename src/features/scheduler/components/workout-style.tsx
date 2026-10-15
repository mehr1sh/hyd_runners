import { Activity, Bike, Dumbbell, Footprints, Leaf, Moon, PersonStanding, type LucideIcon } from "lucide-react";
import type { WorkoutType } from "@/lib/contracts";

/**
 * Visual identity per workout type. Colour is never the only signal: every
 * card also shows the icon and the type name.
 */
export const WORKOUT_STYLE: Record<WorkoutType, { label: string; icon: LucideIcon; className: string }> = {
  run: { label: "Running", icon: Footprints, className: "border-l-brand-red bg-brand-red-soft" },
  walk_run: { label: "Run/walk", icon: Footprints, className: "border-l-brand-red bg-brand-red-soft" },
  walk: { label: "Walking", icon: PersonStanding, className: "border-l-success bg-emerald-50" },
  strength: { label: "Strength", icon: Dumbbell, className: "border-l-brand-navy bg-brand-navy-soft" },
  conditioning: { label: "Conditioning", icon: Activity, className: "border-l-brand-navy bg-brand-navy-soft" },
  mobility: { label: "Yoga / mobility", icon: Leaf, className: "border-l-amber-600 bg-amber-50" },
  cross_training: { label: "Cross-training", icon: Bike, className: "border-l-sky-700 bg-sky-50" },
  rest: { label: "Rest", icon: Moon, className: "border-l-input bg-card" },
};

export const SESSION_TYPES = [
  "walk_run",
  "run",
  "walk",
  "strength",
  "conditioning",
  "mobility",
  "cross_training",
] as const;
