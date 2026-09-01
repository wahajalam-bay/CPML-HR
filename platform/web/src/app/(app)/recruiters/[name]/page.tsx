import type { Metadata } from "next";
import { RecruiterProfile } from "@/features/recruiters/recruiter-profile";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return {
    title: decoded,
    description: `Recruitment performance profile for ${decoded} — pipeline, conversion, activity and outcomes.`,
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return <RecruiterProfile name={decodeURIComponent(name)} />;
}
