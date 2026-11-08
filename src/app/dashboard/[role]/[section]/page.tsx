import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { isRole, NAV } from "@/lib/nav";

export default async function Section({ params }: PageProps<"/dashboard/[role]/[section]">) {
  const { role, section } = await params;
  const item = isRole(role) ? NAV[role].find((i) => i.slug === section) : undefined;
  if (!item) notFound();
  return (
    <>
      <h1 className="mb-5 text-3xl font-bold">{item.label}</h1>
      <Card className="py-12 text-center text-muted">
        <p className="font-semibold text-navy">Planned for the next build stage</p>
        <p className="mt-1">This screen connects to Supabase (with Row-Level Security) once authentication is in place.</p>
      </Card>
    </>
  );
}
