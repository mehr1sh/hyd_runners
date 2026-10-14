import type { Metadata } from "next";
import { AuthForm } from "@/features/identity/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold text-brand-navy">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to see today&apos;s session.</p>
      </div>
      <AuthForm mode="sign-in" next={typeof next === "string" ? next : undefined} />
    </div>
  );
}
