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
    match: [
      "/schedule",
      "/programmes",
      "/workouts",
      "/activities",
      "/performance",
      "/reports",
      "/hyd-coach",
      "/training",
      "/passport",
      "/recovery",
      "/strength",
    ],
  },
  {
    href: "/explore",
    label: "Explore",
    icon: Compass,
    mobilePrimary: true,
    match: ["/routes", "/runs", "/map", "/conditions"],
  },
  {
    href: "/community",
    label: "Community",
    icon: Users,
    mobilePrimary: true,
    match: [
      "/clubs",
      "/challenges",
      "/feed",
      "/runners",
      "/squads",
      "/matching",
      "/leagues",
      "/professionals",
      "/bookings",
    ],
  },
  { href: "/events", label: "Events", icon: CalendarCheck },
  { href: "/profile", label: "Profile", icon: CircleUserRound },
];

/** Sub-pages shown as tabs inside a section. */
export const SECTION_TABS: { section: string; tabs: { href: string; label: string }[] }[] = [
  {
    section: "/train",
    tabs: [
      { href: "/train", label: "Overview" },
      { href: "/hyd-coach", label: "HYD Coach" },
      { href: "/training", label: "Race prep" },
      { href: "/passport", label: "Race Passport" },
      { href: "/schedule", label: "Schedule" },
      { href: "/programmes", label: "Programmes" },
      { href: "/workouts", label: "Workouts" },
      { href: "/activities", label: "Activities" },
      { href: "/performance", label: "Performance" },
      { href: "/reports", label: "Reports" },
      { href: "/recovery", label: "Recovery" },
      { href: "/strength", label: "Strength" },
    ],
  },
  {
    section: "/explore",
    tabs: [
      { href: "/explore", label: "Overview" },
      { href: "/routes", label: "Routes" },
      { href: "/runs", label: "Group runs" },
      { href: "/runs/radar", label: "Run Radar" },
      { href: "/map", label: "Places" },
      { href: "/conditions", label: "Conditions" },
    ],
  },
  {
    section: "/community",
    tabs: [
      { href: "/community", label: "Community" },
      { href: "/clubs", label: "Clubs" },
      { href: "/challenges", label: "Challenges" },
      { href: "/leagues", label: "Leagues" },
      { href: "/feed", label: "Feed" },
      { href: "/runners", label: "Runners" },
      { href: "/squads", label: "Squads" },
      { href: "/matching", label: "Find partners" },
      { href: "/professionals", label: "Coaches & physios" },
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
