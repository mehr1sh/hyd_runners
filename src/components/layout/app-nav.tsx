"use client";

import type * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { RUNNER_NAV, STAFF_NAV, isActivePath, type NavItem } from "./nav-config";

const staffFor = (hrefs: string[]) => STAFF_NAV.filter((item) => hrefs.includes(item.href));

function SidebarLink({
  item,
  pathname,
  ...rest
}: { item: NavItem; pathname: string } & Omit<React.ComponentProps<typeof Link>, "href">) {
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      {...rest}
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-brand-navy-soft font-semibold text-brand-navy",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-brand-red" />}
      <Icon className="size-4" aria-hidden />
      {item.label}
    </Link>
  );
}

/** Desktop sidebar navigation (lg and up). */
export function SidebarNav({ staffHrefs }: { staffHrefs: string[] }) {
  const pathname = usePathname();
  const staffItems = staffFor(staffHrefs);
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      <ul className="flex flex-col gap-1">
        {RUNNER_NAV.map((item) => (
          <li key={item.href}>
            <SidebarLink item={item} pathname={pathname} />
          </li>
        ))}
      </ul>
      {staffItems.length > 0 && (
        <div>
          <p className="px-3 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Staff</p>
          <ul className="flex flex-col gap-1">
            {staffItems.map((item) => (
              <li key={item.href}>
                <SidebarLink item={item} pathname={pathname} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

/** Mobile bottom tab bar with a "More" sheet for secondary destinations. */
export function MobileTabBar({ staffHrefs }: { staffHrefs: string[] }) {
  const pathname = usePathname();
  const staffItems = staffFor(staffHrefs);
  const primary = RUNNER_NAV.filter((i) => i.mobilePrimary);
  const secondary = [...RUNNER_NAV.filter((i) => !i.mobilePrimary), ...staffItems];
  const moreActive = secondary.some((i) => isActivePath(pathname, i.href));

  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground",
      active && "font-semibold text-brand-navy",
    );

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {primary.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                <Icon className={cn("size-5", active && "text-brand-red")} aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
        <li className="flex flex-1">
          <Sheet>
            <SheetTrigger className={tabClass(moreActive)}>
              <Ellipsis className={cn("size-5", moreActive && "text-brand-red")} aria-hidden />
              More
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl">
              <SheetHeader>
                <SheetTitle>More</SheetTitle>
              </SheetHeader>
              <ul className="grid gap-1 px-4 pb-6">
                {secondary.map((item) => (
                  <li key={item.href}>
                    <SheetClose asChild>
                      <SidebarLink item={item} pathname={pathname} />
                    </SheetClose>
                  </li>
                ))}
              </ul>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
