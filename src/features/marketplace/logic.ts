export const SERVICE_KINDS = {
  training_consultation: "Training consultation",
  form_review: "Running form review",
  strength_programme: "Strength programme",
  mobility_session: "Mobility session",
  race_preparation: "Race preparation",
  physiotherapy: "Physiotherapy (verified physiotherapists only)",
} as const;
export type ServiceKind = keyof typeof SERVICE_KINDS;

export const BOOKING_STATUS = {
  requested: "Waiting for confirmation",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled_by_runner: "Cancelled by the runner",
  cancelled_by_professional: "Cancelled by the professional",
  completed: "Completed",
} as const;

export const BOUNDARIES = [
  "Coaches give training guidance. They don't diagnose or treat injuries or medical conditions.",
  "Physiotherapy is offered only by profiles verified as physiotherapists; it isn't emergency care.",
  "Verification means an administrator checked the listed credentials with the issuing body. It is not an endorsement.",
  "HYD Runners doesn't take payments. Any fee is agreed directly with the professional.",
];

/**
 * Payment provider boundary. Only the disabled provider exists: real payment
 * collection and commissions need separate authorisation (see docs/marketplace.md).
 */
export interface PaymentProvider {
  readonly name: string;
  readonly enabled: boolean;
  describe(): string;
}

export const disabledPayments: PaymentProvider = {
  name: "none",
  enabled: false,
  describe: () => "Payments are not enabled. Fees, if any, are arranged directly with the professional.",
};
