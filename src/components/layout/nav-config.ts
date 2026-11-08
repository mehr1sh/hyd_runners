import {
  Activity,
  CalendarDays,
  ChartColumn,
  CircleUserRound,
  ClipboardList,
  Dumbbell,
  Flag,
  LayoutDashboard,
  MapPin,
  Repeat,
  Route,
  CalendarCheck,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/contracts";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar (max four); the rest live under "More". */
  mobilePrimary?: boolean;
  /** Visible only to these roles. Omit for every signed-in user. */
  roles?: readonly Role[];
};

export const RUNNER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: LayoutDashboard, mobilePrimary: true },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, mobilePrimary: true },
  { href: "/programmes", label: "Programmes", icon: Dumbbell, mobilePrimary: true },
  { href: "/workouts", label: "Workouts", icon: Activity, mobilePrimary: true },
  { href: "/reports", label: "Reports", icon: ChartColumn },
  { href: "/community", label: "Community", icon: Users },
  { href: "/events", label: "Events", icon: CalendarCheck },
  { href: "/runs", label: "Group runs", icon: Repeat },
  { href: "/routes", label: "Routes", icon: Route },
  { href: "/clubs", label: "Clubs", icon: Flag },
  { href: "/map", label: "Map", icon: MapPin },
  { href: "/profile", label: "Profile", icon: CircleUserRound },
];

export const STAFF_NAV: NavItem[] = [
  { href: "/coach", label: "Coach", icon: ClipboardList, roles: ["coach", "mentor", "programme_manager", "admin"] },
  { href: "/manager", label: "Programme manager", icon: ShieldCheck, roles: ["programme_manager", "admin"] },
];

export function visibleStaffNav(roles: readonly Role[] | null) {
  // Without Supabase (preview mode) roles are unknown: show staff links so shells can be reviewed.
  if (roles === null) return STAFF_NAV;
  return STAFF_NAV.filter((item) => !item.roles || item.roles.some((r) => roles.includes(r)));
}

export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
