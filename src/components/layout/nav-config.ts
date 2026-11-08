import {
  CircleUserRound,
  Compass,
  ClipboardList,
  Dumbbell,
  LayoutDashboard,
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
  /** Other paths that belong to this section (keeps the section highlighted). */
  match?: readonly string[];
};

/** The six sections of the app. Existing pages keep their URLs. */
export const RUNNER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: LayoutDashboard, mobilePrimary: true },
  {
    href: "/train",
    label: "Train",
    icon: Dumbbell,
    mobilePrimary: true,
    match: ["/schedule", "/programmes", "/workouts", "/reports"],
  },
  { href: "/explore", label: "Explore", icon: Compass, mobilePrimary: true, match: ["/routes", "/runs", "/map"] },
  { href: "/community", label: "Community", icon: Users, mobilePrimary: true, match: ["/clubs"] },
  { href: "/events", label: "Events", icon: CalendarCheck },
  { href: "/profile", label: "Profile", icon: CircleUserRound },
];

/** Sub-pages shown as tabs inside a section. */
export const SECTION_TABS: { section: string; tabs: { href: string; label: string }[] }[] = [
  {
    section: "/train",
    tabs: [
      { href: "/train", label: "Overview" },
      { href: "/schedule", label: "Schedule" },
      { href: "/programmes", label: "Programmes" },
      { href: "/workouts", label: "Workouts" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    section: "/explore",
    tabs: [
      { href: "/explore", label: "Overview" },
      { href: "/routes", label: "Routes" },
      { href: "/runs", label: "Group runs" },
      { href: "/map", label: "Places" },
    ],
  },
  {
    section: "/community",
    tabs: [
      { href: "/community", label: "Community" },
      { href: "/clubs", label: "Clubs" },
    ],
  },
];

export function isActiveItem(pathname: string, item: NavItem) {
  return isActivePath(pathname, item.href) || (item.match ?? []).some((href) => isActivePath(pathname, href));
}

/** The tabs for the section the current page belongs to, if any. */
export function sectionTabsFor(pathname: string) {
  return SECTION_TABS.find((s) => s.tabs.some((t) => isActivePath(pathname, t.href)))?.tabs ?? null;
}

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
