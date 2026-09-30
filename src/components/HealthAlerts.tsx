"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HealthWarning } from "./types";

/** Problems the automation supervisor currently sees; each disappears once resolved. */
export function HealthAlerts({ warnings }: { warnings: HealthWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {warnings.map((w) => (
        <Alert key={w.id} variant={w.level === "error" ? "destructive" : "default"}>
          {w.level === "error" ? <CircleAlert /> : <TriangleAlert />}
          <AlertTitle>{w.title}</AlertTitle>
          <AlertDescription>{w.detail}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
