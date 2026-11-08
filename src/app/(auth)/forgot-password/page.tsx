import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/identity/components/forgot-password-form";
import { forgotPasswordNotice } from "@/features/identity/logic/password-reset";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  const { error } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold text-brand-navy">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a link to choose a new one.
        </p>
      </div>
      <ForgotPasswordForm notice={forgotPasswordNotice(error)} />
    </div>
  );
}
