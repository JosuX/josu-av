"use client";

import { useId } from "react";
import { MotionConfig, motion, type HTMLMotionProps } from "motion/react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// Shared motion building blocks. Everything honours the system's reduced-motion setting.

/** Easing and springs used across the app, so movement feels consistent. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.8 } as const;

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.35, ease: EASE }}>
      {children}
    </MotionConfig>
  );
}

/** Fade and rise into place; `index` staggers siblings. */
export function Reveal({ index = 0, className, ...props }: HTMLMotionProps<"div"> & { index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.05 * index }}
      className={className}
      {...props}
    />
  );
}

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  /** Accessible name when the label isn't plain text. */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A single-choice switch whose highlight slides to the chosen option. Built on Radix's toggle
 * group, so it stays a radio group for keyboards and screen readers.
 */
export function Segmented({
  value,
  onValueChange,
  options,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SegmentedOption[];
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const id = useId();
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <ToggleGroupPrimitive.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            aria-label={o.ariaLabel}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap outline-none transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
              "[&_svg]:size-3.5 [&_svg]:shrink-0",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              o.className,
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                transition={SPRING}
                className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-border dark:bg-input/40"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
}
