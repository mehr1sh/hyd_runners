import type { Metadata } from "next";
import { AuthForm } from "@/features/identity/components/auth-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold text-brand-navy">Start your plan</h1>
        <p className="text-sm text-muted-foreground">It takes about two minutes. No experience needed.</p>
      </div>
      <AuthForm mode="sign-up" />
    </div>
  );
}
