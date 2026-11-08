import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPage } from "@/components/auth-page";
import { getSession } from "@/lib/auth";
import { safeNext } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };
export default async function Login({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const s = await getSession();
  if (s) redirect(`/dashboard/${s.profile.role}`);
  return <AuthPage mode="login" next={safeNext(next, "")} />;
}
