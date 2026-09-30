"use client";

import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE } from "./motion";
import type { HealthWarning } from "./types";

/** Problems the automation supervisor currently sees; each slides away once resolved. */
export function HealthAlerts({ warnings }: { warnings: HealthWarning[] }) {
  return (
    <AnimatePresence initial={false}>
      {warnings.map((w) => (
        <motion.div
          key={w.id}
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="overflow-hidden"
        >
          <div
            role="alert"
            className={cn(
              "flex gap-3 rounded-xl border px-4 py-3 text-sm",
              w.level === "error"
                ? "border-destructive/30 bg-destructive/10"
                : "border-warning/30 bg-warning/10",
            )}
          >
            {w.level === "error" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <div className="min-w-0">
              <p className="font-medium">{w.title}</p>
              <p className="text-muted-foreground">{w.detail}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
