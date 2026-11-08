import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPage } from "@/components/auth-page";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "New password" };
export default async function Reset() {
  if (!(await getSession())) redirect("/forgot-password?error=expired"); // only reachable with a valid recovery session
  return <AuthPage mode="reset" />;
}
