import Link from "next/link";
import { cn } from "@/lib/utils";

export const Drop = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn("inline-block size-6 shrink-0 -rotate-45 rounded-[50%_0_50%_50%] bg-gradient-to-br from-coral to-burgundy", className)} />
);

export function Brand({ light, href = "/" }: { light?: boolean; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 whitespace-nowrap font-display text-base font-bold sm:text-lg", light ? "text-white" : "text-burgundy")}>
      <Drop /> DonorConnect AI
    </Link>
  );
}
