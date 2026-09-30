"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, Cog, LayoutGrid, Server, Users, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { LogConsole, type LogSource } from "./LogConsole";
import { EASE, Reveal, Segmented } from "./motion";

export type LogView = "all" | string;

const ICONS: Record<string, LucideIcon> = {
  mediamtx: Server,
  ffmpeg: Cog,
  clients: Users,
  obs: Video,
  automation: Bot,
};

/** Grid for "All" on wide screens: every log visible at once. */
function gridClass(n: number) {
  if (n <= 1) return "flex";
  if (n === 2) return "grid lg:grid-cols-2";
  if (n <= 4) return "grid lg:grid-cols-2 lg:grid-rows-2";
  return "grid lg:grid-cols-3 lg:grid-rows-2";
}

export function LogMonitor({ logs, initialView }: { logs: LogSource[]; initialView: LogView }) {
  const router = useRouter();
  const [view, setView] = useState<LogView>(initialView);

  const change = (v: string) => {
    if (!v) return;
    setView(v);
    router.replace(v === "all" ? "/logs" : `/logs?view=${v}`, { scroll: false });
  };

  const shown = view === "all" ? logs : logs.filter((l) => l.name === view);

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-3.5rem-3rem)] lg:min-h-[480px]">
      <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Log monitor</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Process output, viewers, OBS and automation, live.
          </p>
        </div>
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <Segmented
            aria-label="Log view"
            value={view}
            onValueChange={change}
            options={[
              { value: "all", label: <><LayoutGrid /> All</>, ariaLabel: "All logs" },
              ...logs.map((l) => {
                const Icon = ICONS[l.name] ?? Server;
                return { value: l.name, label: <><Icon /> {l.label}</>, ariaLabel: l.label };
              }),
            ]}
          />
        </div>
      </Reveal>

      <div className={cn("gap-4 lg:min-h-0 lg:flex-1", view === "all" ? gridClass(logs.length) : "flex", "flex-col lg:flex-row")}>
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((l) => (
            <motion.div
              key={l.name}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3, ease: EASE }}
              className={cn(
                "flex min-h-[320px] min-w-0 flex-1 lg:h-auto lg:min-h-0",
                shown.length > 1 ? "h-[60dvh]" : "h-[calc(100dvh-13rem)]",
              )}
            >
              <LogConsole source={l} className="min-w-0 flex-1" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
