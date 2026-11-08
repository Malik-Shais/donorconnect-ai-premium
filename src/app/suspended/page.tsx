import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Account suspended" };
export default function Suspended() {
  return (
    <main id="main" className="grid min-h-dvh content-start gap-8 px-5 py-8">
      <div className="mx-auto w-full max-w-md"><Brand /></div>
      <Card className="mx-auto w-full max-w-md p-6">
        <h1 className="mb-2 text-3xl font-bold">Account suspended</h1>
        <p className="mb-5 text-muted">Your account has been suspended by an administrator, so you can&apos;t use DonorConnect right now. If you think this is a mistake, please contact the DonorConnect team.</p>
        <form action={logoutAction}><Button variant="outline">Sign out</Button></form>
      </Card>
    </main>
  );
}
