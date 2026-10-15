import type { Role } from "@/lib/contracts";

export const MANAGER_ROLES = ["programme_manager", "admin"] as const satisfies readonly Role[];
export const COACH_ROLES = ["coach", "mentor", "programme_manager", "admin"] as const satisfies readonly Role[];
export const GRANTABLE_ROLES = ["coach", "mentor"] as const satisfies readonly Role[];

export function hasAnyRole(roles: readonly Role[], allowed: readonly Role[]) {
  return roles.some((role) => allowed.includes(role));
}

export function canManageCommunity(roles: readonly Role[]) {
  return hasAnyRole(roles, MANAGER_ROLES);
}

export function canReviewFeedback(
  roles: readonly Role[],
  feedback: { userId: string; assignedTo: string | null },
  userId: string,
) {
  if (feedback.userId === userId) return true;
  if (canManageCommunity(roles)) return true;
  return feedback.assignedTo === userId && hasAnyRole(roles, ["coach", "mentor"]);
}

export function assertGrantableRole(role: string): role is (typeof GRANTABLE_ROLES)[number] {
  return (GRANTABLE_ROLES as readonly string[]).includes(role);
}
