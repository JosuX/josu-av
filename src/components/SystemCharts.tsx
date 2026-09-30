"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, MemoryStick, Network } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatBits, formatBytes, formatClock } from "./format";
import { STATS_HISTORY } from "@/lib/shared";
import type { StatSample } from "./types";

const GiB = 1024 ** 3;

/** Round GiB ticks (e.g. 0, 8, 16, 24, 32) spanning the machine's total memory. */
function memTicks(total: number): number[] {
  const step = [1, 2, 4, 8, 16, 32, 64, 128].find((s) => total / GiB / s <= 5) ?? 256;
  const ticks = [];
  for (let v = 0; v < total; v += step * GiB) ticks.push(v);
  return ticks;
}

function useStatsStream() {
  const [samples, setSamples] = useState<StatSample[]>([]);
  useEffect(() => {
    const es = new EventSource("/api/stats");
    es.addEventListener("history", (e) => setSamples(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("sample", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as StatSample;
      setSamples((prev) => [...prev.slice(-(STATS_HISTORY - 1)), s]);
    });
    return () => es.close();
  }, []);
  return samples;
}

const netConfig = {
  rxBps: { label: "Download", color: "var(--chart-1)" },
  txBps: { label: "Upload", color: "var(--chart-2)" },
} satisfies ChartConfig;

const memConfig = {
  memUsed: { label: "Used", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function SystemCharts() {
  const samples = useStatsStream();
  const last = samples.at(-1);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Network className="size-4 text-muted-foreground" /> Network
            {last && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {last.iface}
              </Badge>
            )}
          </h3>
          <div className="ml-auto flex gap-5">
            <Headline icon={<ArrowDown className="size-4" />} label="Download" color="var(--chart-1)" value={last ? formatBits(last.rxBps) : null} />
            <Headline icon={<ArrowUp className="size-4" />} label="Upload" color="var(--chart-2)" value={last ? formatBits(last.txBps) : null} />
          </div>
        </div>
          {samples.length < 2 ? (
            <Skeleton className="h-28 w-full sm:h-32" />
          ) : (
            <ChartContainer config={netConfig} className="aspect-auto h-28 w-full sm:h-32">
              <AreaChart data={samples} margin={{ left: 0, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="ts" tickFormatter={formatClock} tickLine={false} axisLine={false} minTickGap={64} fontSize={10} />
                <YAxis tickFormatter={formatBits} tickLine={false} axisLine={false} width={56} fontSize={10} />
                <ChartTooltip
                  cursor
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      labelFormatter={(_, p) => formatClock(p?.[0]?.payload?.ts)}
                      formatter={(v, name) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="h-2.5 w-1 rounded-sm" style={{ background: `var(--color-${name})` }} />
                            {netConfig[name as keyof typeof netConfig].label}
                          </span>
                          <span className="font-mono tabular-nums">{formatBits(Number(v))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Area dataKey="rxBps" type="monotone" stroke="var(--color-rxBps)" strokeWidth={2} fill="var(--color-rxBps)" fillOpacity={0.12} isAnimationActive={false} dot={false} />
                <Area dataKey="txBps" type="monotone" stroke="var(--color-txBps)" strokeWidth={2} fill="var(--color-txBps)" fillOpacity={0.12} isAnimationActive={false} dot={false} />
              </AreaChart>
            </ChartContainer>
          )}
      </Card>

      <Card className="gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <MemoryStick className="size-4 text-muted-foreground" /> Memory
          </h3>
          <div className="ml-auto flex gap-5">
            <Headline
              label="Used"
              color="var(--chart-1)"
              value={last ? `${formatBytes(last.memUsed)} / ${formatBytes(last.memTotal)}` : null}
            />
            <Headline label="Utilisation" value={last ? `${((last.memUsed / last.memTotal) * 100).toFixed(1)}%` : null} />
          </div>
        </div>
          {samples.length < 2 ? (
            <Skeleton className="h-28 w-full sm:h-32" />
          ) : (
            <ChartContainer config={memConfig} className="aspect-auto h-28 w-full sm:h-32">
              <AreaChart data={samples} margin={{ left: 0, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="ts" tickFormatter={formatClock} tickLine={false} axisLine={false} minTickGap={64} fontSize={10} />
                <YAxis
                  domain={[0, last?.memTotal ?? "auto"]}
                  ticks={last ? memTicks(last.memTotal) : undefined}
                  tickFormatter={formatBytes}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  fontSize={10}
                />
                <ChartTooltip
                  cursor
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      labelFormatter={(_, p) => formatClock(p?.[0]?.payload?.ts)}
                      formatter={(v, _name, item) => (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">Used</span>
                          <span className="font-mono tabular-nums">
                            {formatBytes(Number(v))} ({((Number(v) / item.payload.memTotal) * 100).toFixed(1)}%)
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Area dataKey="memUsed" type="monotone" stroke="var(--color-memUsed)" strokeWidth={2} fill="var(--color-memUsed)" fillOpacity={0.15} isAnimationActive={false} dot={false} />
              </AreaChart>
            </ChartContainer>
          )}
      </Card>
    </div>
  );
}

function Headline({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string | null;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {color && <span className="h-2.5 w-1 rounded-sm" style={{ background: color }} />}
        {icon}
        {label}
      </span>
      {value === null ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
      )}
    </div>
  );
}
