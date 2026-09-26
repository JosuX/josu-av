"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Columns2, Square } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LogConsole } from "./LogConsole";
import type { ProcName } from "./types";

export type LogView = "split" | ProcName;

export function LogMonitor({ initialView }: { initialView: LogView }) {
  const router = useRouter();
  const [view, setView] = useState<LogView>(initialView);

  const change = (v: string) => {
    if (!v) return;
    setView(v as LogView);
    router.replace(v === "split" ? "/logs" : `/logs?view=${v}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-3.5rem-3rem)] lg:min-h-[480px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Log monitor</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">Live output from processes started by this panel.</p>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={change} className="w-full sm:w-auto [&>*]:flex-1">
          <ToggleGroupItem value="split" aria-label="Split view">
            <Columns2 /> Both
          </ToggleGroupItem>
          <ToggleGroupItem value="mediamtx">
            <Square /> MediaMTX
          </ToggleGroupItem>
          <ToggleGroupItem value="ffmpeg">
            <Square /> FFmpeg
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={view === "split" ? "grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2" : "flex lg:min-h-0 lg:flex-1"}>
        {(view === "split" || view === "mediamtx") && <LogConsole name="mediamtx" className="h-[calc(100dvh-13rem)] min-h-[320px] flex-1 lg:h-auto" />}
        {(view === "split" || view === "ffmpeg") && <LogConsole name="ffmpeg" className="h-[calc(100dvh-13rem)] min-h-[320px] flex-1 lg:h-auto" />}
      </div>
    </div>
  );
}
