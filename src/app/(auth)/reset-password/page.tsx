import type { Metadata } from "next";
import { ResetPasswordForm, ResetPasswordSessionMissing } from "@/features/identity/components/reset-password-form";
import { RESET_SESSION_MISSING_MESSAGE } from "@/features/identity/logic/password-reset";
import { getCurrentUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Reached from the reset email via /auth/callback, which exchanges the code for
 * a recovery session. Without a session it explains how to get a new link.
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold text-brand-navy">Choose a new password</h1>
        {user && (
          <p className="text-sm text-muted-foreground">
            Other devices will be signed out. You&apos;ll stay signed in here.
          </p>
        )}
      </div>
      {user ? (
        <ResetPasswordForm email={user.email} />
      ) : (
        <ResetPasswordSessionMissing message={RESET_SESSION_MISSING_MESSAGE} />
      )}
    </div>
  );
}
