import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProcState } from "./types";

const STYLES: Record<ProcState | "external", { label: string; dot: string; pulse?: boolean }> = {
  running: { label: "Running", dot: "bg-success", pulse: true },
  starting: { label: "Starting", dot: "bg-warning", pulse: true },
  restarting: { label: "Restarting", dot: "bg-warning", pulse: true },
  stopping: { label: "Stopping", dot: "bg-warning", pulse: true },
  stopped: { label: "Stopped", dot: "bg-muted-foreground/60" },
  crashed: { label: "Crashed", dot: "bg-destructive" },
  external: { label: "Running externally", dot: "bg-warning" },
};

export function StateBadge({ state }: { state: ProcState | "external" }) {
  const s = STYLES[state];
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className="relative flex size-2">
        {s.pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", s.dot)} />}
        <span className={cn("relative inline-flex size-2 rounded-full", s.dot)} />
      </span>
      {s.label}
    </Badge>
  );
}

export function ReadyDot({ ready, label }: { ready: boolean | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-2 rounded-full",
          ready === null ? "bg-muted-foreground/40" : ready ? "bg-success" : "bg-muted-foreground/60",
        )}
      />
      {label}: {ready === null ? "unknown" : ready ? "live" : "offline"}
    </span>
  );
}
