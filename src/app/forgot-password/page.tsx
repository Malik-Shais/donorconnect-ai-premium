import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";

export const metadata: Metadata = { title: "Reset password" };
export default async function Forgot({ searchParams }: PageProps<"/forgot-password">) {
  const { error } = await searchParams;
  return <AuthPage mode="forgot" notice={error ? "That reset link is invalid or has expired. Request a new one." : undefined} />;
}
