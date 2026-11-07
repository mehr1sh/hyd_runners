import { z } from "zod";
import { IsoDate } from "@/lib/contracts";
import { isMonday } from "../logic/time";
import { PlannerSettings, ProposalPayload } from "../logic/types";

/** Request bodies for the schedule endpoints. */

export const WeekStart = IsoDate.refine(isMonday, { message: "weekStart must be a Monday" });

export const GenerateBody = z.object({
  weekStart: WeekStart,
  settings: PlannerSettings,
  /** Ask for an AI-assisted arrangement when AI is configured. */
  useAi: z.boolean().default(true),
});

export const ValidateBody = ProposalPayload.extend({ weekStart: WeekStart });

export const ApproveBody = ProposalPayload.extend({
  weekStart: WeekStart,
  source: z.enum(["deterministic", "ai_assisted"]),
  /** Must be true to replace a plan that is already approved for this week. */
  replaceExisting: z.boolean().default(false),
});
