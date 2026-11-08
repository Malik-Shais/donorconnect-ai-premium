import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPage } from "@/components/auth-page";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Create account" };
export default async function Register({ searchParams }: PageProps<"/register">) {
  const { role } = await searchParams;
  const s = await getSession();
  if (s) redirect(`/dashboard/${s.profile.role}`);
  return <AuthPage mode="register" role={role === "requester" ? "requester" : "donor"} />;
}
