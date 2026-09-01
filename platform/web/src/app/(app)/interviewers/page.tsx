import type { Metadata } from "next";
import { DimensionAnalytics } from "@/features/dimension/dimension-analytics";

export const metadata: Metadata = {
  title: "Interviewers",
  description:
    "Hiring-manager interview load, selectivity and downstream outcomes across the CPML business.",
};

export default function Page() {
  return (
    <DimensionAnalytics
      config={{
        field: "hiring_manager",
        title: "Interviewer Analytics",
        entity: "Hiring manager",
        icon: "users",
        description:
          "Who interviews, how selectively, and what happens to the candidates they pass. Wide variation in select rate on comparable candidate pools is a calibration problem, not a quality signal.",
        minApplications: 15,
        note: "Select rate should be read alongside volume: a manager who has seen fifteen candidates has not yet produced a stable rate, which is why low-volume interviewers are held back from the comparison.",
      }}
    />
  );
}
