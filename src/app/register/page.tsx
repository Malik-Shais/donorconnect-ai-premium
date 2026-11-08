import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };
export default async function Register({ searchParams }: PageProps<"/register">) {
  const { role } = await searchParams;
  return (
    <main id="main" className="grid min-h-dvh content-start gap-8 px-5 py-8">
      <div className="mx-auto w-full max-w-md"><Brand /></div><AuthForm mode="register" role={role === "requester" ? "requester" : "donor"} />
    </main>
  );
}
