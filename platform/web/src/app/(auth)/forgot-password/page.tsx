import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/auth/reset-forms";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ForgotPasswordForm />;
}
