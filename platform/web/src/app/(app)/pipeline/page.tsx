import type { Metadata } from "next";
import { PipelineAnalytics } from "@/features/pipeline/pipeline-analytics";

export const metadata: Metadata = {
  title: "Pipeline",
  description:
    "Stage-by-stage conversion, cohort progression and the exact points where candidates leave the CPML funnel.",
};

export default function Page() {
  return <PipelineAnalytics />;
}
