import { Badge } from "@/components/ui/badge";
import type { ProfessionalProfile } from "../queries";

const LABEL: Record<ProfessionalProfile["verificationStatus"], string> = {
  verified: "Verified",
  pending: "Verification pending",
  unverified: "Not verified",
  rejected: "Not verified",
  suspended: "Suspended",
};

/** Only "verified" ever reads as verified. */
export function VerificationBadge({ status }: { status: ProfessionalProfile["verificationStatus"] }) {
  return (
    <Badge
      variant={status === "verified" ? "default" : "outline"}
      className={status === "verified" ? "bg-success text-white" : ""}
    >
      {LABEL[status]}
    </Badge>
  );
}
