import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { SetupNotice } from "@/components/shared/setup-notice";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MobileTabBar, SectionTabs, SidebarNav } from "./app-nav";
import { visibleStaffNav } from "./nav-config";
import { UserMenu } from "./user-menu";

/** Signed-in application frame: header, desktop sidebar, mobile tab bar. */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const staffHrefs = visibleStaffNav(user ? user.roles : null).map((item) => item.href);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <SetupNotice />
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo href="/dashboard" priority />
          <UserMenu user={user} />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 sm:px-6">
        <aside className="sticky top-18 hidden h-[calc(100dvh-4.5rem)] w-56 shrink-0 overflow-y-auto py-8 lg:block">
          <SidebarNav staffHrefs={staffHrefs} />
        </aside>
        <main id="main" className="min-w-0 flex-1 pt-6 pb-28 sm:pt-8 lg:pb-12">
          <SectionTabs />
          {children}
        </main>
      </div>
      <MobileTabBar staffHrefs={staffHrefs} />
    </div>
  );
}
