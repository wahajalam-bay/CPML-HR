import type { Metadata } from "next";
import { DimensionAnalytics } from "@/features/dimension/dimension-analytics";

export const metadata: Metadata = {
  title: "Roles",
  description:
    "Requisition-level demand, difficulty and fill performance for every role CPML recruits for.",
};

export default function Page() {
  return (
    <DimensionAnalytics
      config={{
        field: "applied_role",
        title: "Role Analytics",
        entity: "Role",
        icon: "gauge",
        description:
          "How hard each role is to fill, measured by applications consumed per hire, pitch pass rate and time to hire.",
        minApplications: 10,
        note: "Associate/AM dominates the intake by an order of magnitude, so senior roles will always look volatile on rate-based measures. Judge those on applications-per-hire rather than on conversion percentage.",
      }}
    />
  );
}
