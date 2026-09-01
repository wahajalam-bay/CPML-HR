import type { Metadata } from "next";
import { TalentInsights } from "@/features/talent/talent-insights";

export const metadata: Metadata = {
  title: "Talent Insights",
  description:
    "Who applies to CPML, which backgrounds actually convert, and what the market expects to be paid.",
};

export default function Page() {
  return <TalentInsights />;
}
