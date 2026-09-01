import type { Metadata } from "next";
import { LossAnalytics } from "@/features/attrition/loss-analytics";

export const metadata: Metadata = {
  title: "Loss Analysis",
  description:
    "Every reason candidates leave the CPML funnel, attributed to the stage it happened at and costed by how far they had progressed.",
};

export default function Page() {
  return <LossAnalytics />;
}
