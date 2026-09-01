"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] font-medium transition-[background-color,border-color,color,box-shadow] outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-fg border border-accent hover:bg-accent-hover hover:border-accent-hover",
        default:
          "bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-2",
        subtle:
          "bg-surface-2 text-ink border border-transparent hover:bg-surface-3",
        ghost:
          "bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink",
        danger:
          "bg-critical text-white border border-critical hover:brightness-110",
        link: "bg-transparent text-accent underline-offset-4 hover:underline p-0 h-auto border-0",
      },
      size: {
        xs: "h-6 px-2 text-label [&_svg]:size-3",
        sm: "h-7 px-2.5 text-meta [&_svg]:size-3.5",
        md: "h-8 px-3 text-body [&_svg]:size-4",
        lg: "h-9 px-4 text-body [&_svg]:size-4",
        icon: "size-7 [&_svg]:size-4",
        "icon-sm": "size-6 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "sm" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
