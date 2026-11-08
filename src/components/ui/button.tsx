import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 whitespace-nowrap items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-gradient-to-br from-burgundy to-coral-dark text-white shadow-[0_6px_18px_rgb(122_22_48/0.28)] hover:shadow-[0_10px_26px_rgb(122_22_48/0.34)]",
        teal: "bg-teal text-white hover:bg-teal/90",
        outline: "border-[1.5px] border-line bg-transparent text-navy hover:bg-white",
        ghost: "text-navy hover:bg-navy/5",
      },
      size: { default: "px-6 py-3 text-[0.95rem]", sm: "min-h-9 px-4 py-2 text-sm", lg: "px-8 py-4 text-base" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
