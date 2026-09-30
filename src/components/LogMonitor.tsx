"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, Cog, LayoutGrid, Server, Users, Video, type LucideIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { LogConsole, type LogSource } from "./LogConsole";

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Log monitor</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Process output, viewers, OBS and automation, live.
          </p>
        </div>
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={change} className="w-max">
            <ToggleGroupItem value="all" aria-label="All logs">
              <LayoutGrid /> All
            </ToggleGroupItem>
            {logs.map((l) => {
              const Icon = ICONS[l.name] ?? Server;
              return (
                <ToggleGroupItem key={l.name} value={l.name}>
                  <Icon /> {l.label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
      </div>

      <div className={cn("gap-4 lg:min-h-0 lg:flex-1", view === "all" ? gridClass(logs.length) : "flex", "flex-col lg:flex-row")}>
        {shown.map((l) => (
          <LogConsole
            key={l.name}
            source={l}
            className={cn(
              "min-h-[320px] flex-1 lg:h-auto lg:min-h-0",
              shown.length > 1 ? "h-[60dvh]" : "h-[calc(100dvh-13rem)]",
            )}
          />
        ))}
      </div>
    </div>
  );
}
