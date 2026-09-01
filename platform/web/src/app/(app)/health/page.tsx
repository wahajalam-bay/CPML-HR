import type { Metadata } from "next";
import { HealthScorecards } from "@/features/health/health-scorecards";

export const metadata: Metadata = {
  title: "Recruitment Health",
  description:
    "Operational scorecards for every recruiter, stage, source and business unit — scored against CPML's own baseline.",
};

export default function Page() {
  return <HealthScorecards />;
}
