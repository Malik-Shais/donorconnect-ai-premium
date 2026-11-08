import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input ref={ref} className={cn("min-h-11 w-full rounded-xl border-[1.5px] border-line bg-white px-3.5 py-2.5 text-ink placeholder:text-muted/70 focus:border-teal focus:outline-3 focus:outline-teal/20", className)} {...p} />
  ),
);
Input.displayName = "Input";
