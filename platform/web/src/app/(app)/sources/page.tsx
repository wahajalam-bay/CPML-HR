import type { Metadata } from "next";
import { DimensionAnalytics } from "@/features/dimension/dimension-analytics";

export const metadata: Metadata = {
  title: "Sources",
  description:
    "Which sourcing channels produce hires rather than just applications — volume, conversion, cost of effort and quality of candidate.",
};

export default function Page() {
  return (
    <DimensionAnalytics
      config={{
        field: "source",
        title: "Source Analytics",
        entity: "Source",
        icon: "activity",
        description:
          "Channel performance measured on hires delivered, not applications supplied. The largest channel is rarely the most efficient one.",
        minApplications: 20,
        note: "Volume and yield pull in opposite directions here: the channel that fills the top of the funnel is not the one that fills seats. Read the scatter before reallocating effort.",
      }}
    />
  );
}
