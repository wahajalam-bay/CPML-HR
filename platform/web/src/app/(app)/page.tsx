import type { Metadata } from "next";
import { CommandCenter } from "@/features/command-center/command-center";

export const metadata: Metadata = {
  title: "Command Center",
  description:
    "The state of the entire CPML recruitment operation — intake, conversion, velocity, recruiter performance and live alerts.",
};

export default function Page() {
  return <CommandCenter />;
}
