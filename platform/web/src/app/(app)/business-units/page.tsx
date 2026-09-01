import type { Metadata } from "next";
import { DimensionAnalytics } from "@/features/dimension/dimension-analytics";

export const metadata: Metadata = {
  title: "Business Units",
  description:
    "Hiring volume, pipeline health and outcomes by directorate across the CPML sales organisation.",
};

export default function Page() {
  return (
    <DimensionAnalytics
      config={{
        field: "team",
        title: "Business Units",
        entity: "Directorate",
        icon: "building",
        description:
          "Demand and delivery by the directorate a hire ultimately joins. Only candidates who reached an offer carry a business unit, so these figures describe the bottom of the funnel.",
        minApplications: 5,
        note: "A directorate is only recorded once an offer is placed. Application and contact figures here therefore reflect the candidates who eventually landed in each unit, not the effort spent sourcing for it.",
      }}
    />
  );
}
