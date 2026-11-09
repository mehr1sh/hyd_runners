import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PaceCalculator } from "@/features/training/components/pace-calculator";

export const metadata: Metadata = { title: "Pace calculator" };

export default function PacePage() {
  return (
    <>
      <PageHeader
        title="Pace calculator"
        description="Work out pace, finish time or distance, race splits (even or negative) and interval targets."
      />
      <div className="max-w-3xl">
        <PaceCalculator />
      </div>
    </>
  );
}
