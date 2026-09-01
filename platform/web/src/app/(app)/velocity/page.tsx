import type { Metadata } from "next";
import { VelocityAnalytics } from "@/features/velocity/velocity-analytics";

export const metadata: Metadata = {
  title: "Velocity & Aging",
  description:
    "How long every hand-off in the CPML pipeline takes, where candidates wait, and how much of the pipeline has stopped moving.",
};

export default function Page() {
  return <VelocityAnalytics />;
}
