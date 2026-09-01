import type { Metadata } from "next";
import { ReportsWorkspace } from "@/features/reports/reports-workspace";

export const metadata: Metadata = {
  title: "Reports",
  description:
    "Board-ready recruitment reports for CPML — executive, recruiter, source, pipeline and loss reporting in PDF, Excel and CSV.",
};

export default function Page() {
  return <ReportsWorkspace />;
}
