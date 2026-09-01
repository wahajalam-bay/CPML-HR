import type { Metadata } from "next";
import { AccessControl } from "@/features/admin/access-control";

export const metadata: Metadata = {
  title: "Access Control",
  description:
    "The complete role and permission model for CPML HR — who can open what, see which fields, take which actions, and the log of what they did.",
};

export default function Page() {
  return <AccessControl />;
}
