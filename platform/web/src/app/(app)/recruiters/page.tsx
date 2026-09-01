import type { Metadata } from "next";
import { DimensionAnalytics } from "@/features/dimension/dimension-analytics";

export const metadata: Metadata = {
  title: "Recruiters",
  description:
    "Individual recruiter productivity, quality and conversion across the CPML recruitment team.",
};

export default function Page() {
  return (
    <DimensionAnalytics
      config={{
        field: "recruiter",
        title: "Recruiter Performance",
        entity: "Recruiter",
        icon: "userCog",
        description:
          "Volume handled and hires delivered for every recruiter. Open a name for their full profile, activity pattern and rejection reasons.",
        minApplications: 25,
        hrefPattern: "/recruiters/{key}",
        note: "Application volume is assigned per record, so a recruiter who inherits a colleague's pipeline carries those applications too. Conversion is the fairer comparison; volume is context for it.",
      }}
    />
  );
}
