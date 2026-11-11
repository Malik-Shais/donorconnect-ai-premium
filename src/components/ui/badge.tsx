import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-block rounded-full px-3 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      neutral: "bg-navy/8 text-navy",
      open: "bg-sky-100 text-sky-800",
      matched: "bg-teal-soft text-teal-900",
      fulfilled: "bg-emerald-100 text-emerald-800",
      urgent: "bg-amber-100 text-amber-800",
      critical: "bg-red-100 text-red-700",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type Tone = NonNullable<VariantProps<typeof badge>["tone"]>;
export const Badge = ({ tone, className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) => (
  <span className={cn(badge({ tone }), className)} {...p} />
);
