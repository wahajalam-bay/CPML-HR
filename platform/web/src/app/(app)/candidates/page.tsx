import type { Metadata } from "next";
import { Suspense } from "react";
import { CandidateExplorer } from "@/features/candidates/candidate-explorer";
import { SkeletonPanel } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Candidate Explorer",
  description:
    "Every CPML application record — sortable, groupable, exportable, with a full timeline for each candidate.",
};

export default function Page() {
  return (
    <Suspense fallback={<SkeletonPanel height={520} />}>
      <CandidateExplorer />
    </Suspense>
  );
}
