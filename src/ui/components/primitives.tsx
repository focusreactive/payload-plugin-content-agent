"use client";

// Every portal-rendering primitive must pass `container={usePortalContainer()}`: a Radix portal
// defaults to `document.body`, outside the shadow tree, where the plugin's styles do not reach.

import React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.js";
import { usePortalContainer } from "../ShadowScope.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-(--radius-ca) font-medium whitespace-nowrap " +
    "transition-colors disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:outline-ca-accent focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ca-accent text-ca-accent-fg hover:opacity-90",
        outline: "border-ca-border bg-ca-bg text-ca-fg hover:bg-ca-surface border",
        ghost: "text-ca-muted hover:bg-ca-surface hover:text-ca-fg",
        danger: "bg-ca-danger text-white hover:opacity-90",
        link: "text-ca-accent underline-offset-2 hover:underline",
      },
      size: {
        sm: "h-11 px-4 text-xs [&_svg]:size-5",
        md: "h-12 px-5 text-sm [&_svg]:size-5.5",
        lg: "h-13 px-6 text-sm [&_svg]:size-6",
        icon: "size-11 [&_svg]:size-5.5",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  }
);
Button.displayName = "Button";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={300}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  children,
  label,
  side = "top",
}: {
  children: React.ReactNode;
  label: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const container = usePortalContainer();

  if (!label) return children;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={container}>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="border-ca-border bg-ca-bg text-2xs text-ca-fg z-[2147483000] max-w-64 rounded-md border px-2 py-1 shadow-md"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "border-ca-border bg-ca-bg text-ca-fg w-full rounded-(--radius-ca) border px-3 py-2.5 text-xs",
      "placeholder:text-ca-faint focus-visible:border-ca-accent focus-visible:outline-none disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
