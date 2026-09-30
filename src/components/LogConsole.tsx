"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Download, Eraser, Search } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { LOG_MAX_LINES } from "@/lib/shared";
import { StateBadge } from "./StateBadge";
import { Segmented } from "./motion";
import { procAction } from "./hooks";
import type { LogLine, ProcName, ProcState } from "./types";

type Tone = "error" | "warn" | "info" | "progress" | "system";

function toneOf(l: LogLine): Tone {
  // Event-log lines carry their level; process output is classified by its text.
  if (l.level) return l.level === "warning" ? "warn" : l.level;
  if (l.stream === "system") return "system";
  const t = l.text;
  if (/(^| )(ERR|FTL)( |$)|\b(error|failed|fatal|invalid|refused|not found)\b/i.test(t)) return "error";
  if (/(^| )WAR( |$)|\bwarn(ing)?\b/i.test(t)) return "warn";
  if (/^(frame|size)=\s*\S+/.test(t)) return "progress";
  return "info";
}

const TONE_CLASS: Record<Tone, string> = {
  error: "text-log-error",
  warn: "text-log-warn",
  info: "text-log-stderr",
  progress: "text-muted-foreground",
  system: "text-log-system font-medium",
};

type Line = LogLine & { tone: Tone };

const withTone = (l: LogLine): Line => ({ ...l, tone: toneOf(l) });
const isIssue = (l: Line) => l.tone === "error" || l.tone === "warn";

type Filter = "all" | "issues";

/** One log: a process's output ("process") or one the panel writes itself ("events"). */
export interface LogSource {
  name: string;
  label: string;
  kind: "process" | "events";
  /** Shown while the log is empty. */
  empty?: string;
}

export function LogConsole({ source, className }: { source: LogSource; className?: string }) {
  const { name, label, kind } = source;
  // Levels are classified once per line on arrival, not on every render.
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<ProcState>("stopped");
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [follow, setFollow] = useState(true);
  const [timestamps, setTimestamps] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/logs/${name}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("backlog", (e) => setLines((JSON.parse((e as MessageEvent).data) as LogLine[]).map(withTone)));
    es.addEventListener("line", (e) => {
      const l = withTone(JSON.parse((e as MessageEvent).data) as LogLine);
      setLines((prev) => (prev.length >= LOG_MAX_LINES ? [...prev.slice(-(LOG_MAX_LINES - 1)), l] : [...prev, l]));
    });
    es.addEventListener("state", (e) => setState(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("clear", () => setLines([]));
    return () => es.close();
  }, [name]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines
      .filter((l) => (filter === "issues" ? isIssue(l) || l.tone === "system" : true))
      .filter((l) => (q ? l.text.toLowerCase().includes(q) : true));
  }, [lines, query, filter]);

  const issues = useMemo(() => lines.filter(isIssue).length, [lines]);

  useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible, follow]);

  // Scrolling up pauses follow; scrolling back to the bottom resumes it.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const clear = () => {
    if (kind === "process") void procAction(name as ProcName, "clear-logs");
    else
      void fetch(`/api/logs/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
  };

  const download = () => {
    const text = lines
      .map((l) => `${new Date(l.ts).toISOString()} [${l.level ?? l.stream}] ${l.text}`)
      .join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${name}-${Date.now()}.log` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className={cn("flex min-h-0 flex-col gap-0 py-0", className)}>
      <CardHeader className="border-b py-3!">
        <CardTitle className="flex items-center gap-2">
          {label}
          {kind === "process" && <StateBadge state={state} />}
          {!connected && <span className="text-xs font-normal text-muted-foreground">reconnecting…</span>}
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Download log" disabled={!lines.length}>
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download log</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={clear} aria-label="Clear log" disabled={!lines.length}>
                <Eraser />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear log</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:gap-3 sm:px-4">
        <div className="relative w-full min-w-40 flex-1 sm:w-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter lines…"
            className="h-8 pl-8"
          />
        </div>
        <Segmented
          aria-label="Show"
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "all", label: "All" },
            {
              value: "issues",
              label: (
                <>
                  Issues{issues ? <span className="font-mono text-log-error">{issues}</span> : null}
                </>
              ),
              ariaLabel: "Issues",
            },
          ]}
        />
        <div className="hidden items-center gap-2 sm:flex">
          <Switch id={`${name}-ts`} checked={timestamps} onCheckedChange={setTimestamps} size="sm" />
          <Label htmlFor={`${name}-ts`} className="text-xs font-normal">Time</Label>
        </div>
      </div>

      <CardContent className="relative min-h-0 flex-1 p-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-auto overscroll-contain bg-log px-3 py-2 font-mono text-[11px] leading-[1.125rem] sm:px-4 sm:text-xs sm:leading-5"
          role="log"
          aria-live="off"
        >
          {visible.length === 0 ? (
            <div className="grid h-full place-items-center text-muted-foreground">
              {lines.length
                ? "No lines match the filter"
                : (source.empty ?? "No output yet — start the process to see its log")}
            </div>
          ) : (
            visible.map((l) => (
              <div key={l.id} className={cn("flex gap-3 whitespace-pre-wrap break-all", TONE_CLASS[l.tone])}>
                {timestamps && (
                  <span className="hidden shrink-0 text-muted-foreground/70 tabular-nums select-none sm:inline">
                    {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
                  </span>
                )}
                <span>{l.text}</span>
              </div>
            ))
          )}
        </div>
        {!follow && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-4 bottom-3 shadow-md"
            onClick={() => setFollow(true)}
          >
            <ArrowDownToLine /> Jump to latest
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
