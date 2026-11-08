import { Card } from "@/components/ui/card";

export const Kpi = ({ value, label }: { value: React.ReactNode; label: string }) => (
  <Card className="p-4">
    <div className="font-display text-3xl font-bold text-burgundy">{value}</div>
    <div className="text-sm text-muted">{label}</div>
  </Card>
);
export const KpiGrid = ({ children }: { children: React.ReactNode }) => <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">{children}</div>;
