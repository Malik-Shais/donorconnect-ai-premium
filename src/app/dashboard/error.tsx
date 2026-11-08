"use client";
import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="m-6 rounded-2xl border border-red-200 bg-red-50 p-6">
      <h2 className="mb-1 text-xl font-bold">Something went wrong</h2>
      <p className="mb-4 text-sm text-red-900">We couldn&apos;t load this page. Your data is safe. Please try again.</p>
      <Button onClick={reset} size="sm">Try again</Button>
    </div>
  );
}
