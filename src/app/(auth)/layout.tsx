import { Logo } from "@/components/brand/logo";
import { SetupNotice } from "@/components/shared/setup-notice";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SetupNotice />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex justify-center">
            <Logo />
          </div>
          <div className="rounded-2xl border bg-card p-6 sm:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
