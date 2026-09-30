"use client";

import { Activity, Gauge, Users } from "lucide-react";
import { motion } from "motion/react";
import CountUp from "./reactbits/CountUp";
import SpotlightCard from "./reactbits/SpotlightCard";
import { EASE } from "./motion";
import { cn } from "@/lib/utils";
import type { StatusPayload } from "./types";

const MODE: Record<string, string> = { off: "Adaptive off", recommend: "Adaptive: recommend", auto: "Adaptive: automatic" };

/** The stream at a glance: viewers, bitrate and playback health. */
export function KpiStrip({ status }: { status: StatusPayload }) {
  const { stream, paths, abr } = status;
  const out = paths?.find((p) => p.name === stream.output);
  const live = stream.outputReady;

  const viewers = abr?.viewers ?? [];
  const count = (source: string) => viewers.filter((v) => v.source === source).length;
  const total = abr ? viewers.length + abr.unmeasured : (out?.readers ?? 0);
  const struggling = viewers.filter((v) => !v.hidden && (v.health === "network" || v.health === "device")).length;
  // "Measuring" only until someone has a verdict; one newcomer doesn't hide everyone else's.
  const judged = viewers.filter((v) => !v.hidden && v.health !== "unknown");
  const measuring = viewers.length > 0 && judged.length === 0;
  const target = abr?.streamActive ? abr.current : null;

  const breakdown = abr
    ? [
        count("dashboard") && `${count("dashboard")} dashboard`,
        count("watch page") && `${count("watch page")} watch page`,
        abr.unmeasured && `${abr.unmeasured} other`,
      ].filter(Boolean)
    : [];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Tile index={0} icon={Users} label="Viewers">
        <Big>
          <CountUp to={total} duration={0.6} />
        </Big>
        <Sub>{breakdown.length ? breakdown.join(" · ") : live ? "No one watching yet" : "Stream offline"}</Sub>
      </Tile>

      <Tile index={1} icon={Gauge} label="Bitrate">
        <Big>
          {live && stream.inKbps != null ? (
            <>
              <CountUp to={stream.inKbps} duration={0.8} separator="," />
              <Unit>kbps</Unit>
            </>
          ) : (
            <Dash />
          )}
        </Big>
        <Sub>
          {target ? `OBS target ${target.toLocaleString("en-US")}` : "OBS target unknown"}
          {abr && ` · ${MODE[abr.mode]}`}
        </Sub>
      </Tile>

      <Tile index={2} icon={Activity} label="Playback" className="col-span-2 lg:col-span-1" tone={struggling ? "bad" : judged.length ? "good" : undefined}>
        <Big>
          {!viewers.length ? (
            <Dash />
          ) : struggling ? (
            <span className="text-destructive">
              <CountUp to={struggling} duration={0.5} /> <Unit>struggling</Unit>
            </span>
          ) : measuring ? (
            <span className="font-sans text-lg font-medium text-muted-foreground">Measuring…</span>
          ) : (
            <span className="font-sans text-success">All smooth</span>
          )}
        </Big>
        <Sub>
          {abr?.lastChange
            ? `Last change ${abr.lastChange.from.toLocaleString("en-US")} → ${abr.lastChange.to.toLocaleString("en-US")} kbps`
            : viewers.length
              ? `${viewers.length} measured ${viewers.length === 1 ? "player" : "players"}`
              : "No measured players"}
        </Sub>
      </Tile>
    </div>
  );
}

function Tile({
  index,
  icon: Icon,
  label,
  tone,
  className,
  children,
}: {
  index: number;
  className?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "good" | "bad";
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.04 * index }}
      className={className}
    >
      <SpotlightCard className="h-full p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span
            className={cn(
              "grid size-7 place-items-center rounded-md bg-muted text-muted-foreground",
              tone === "good" && "bg-success/15 text-success",
              tone === "bad" && "bg-destructive/15 text-destructive",
            )}
          >
            <Icon className="size-3.5" />
          </span>
        </div>
        <div className="mt-2 flex min-w-0 flex-col gap-1">{children}</div>
      </SpotlightCard>
    </motion.div>
  );
}

const Big = ({ children }: { children: React.ReactNode }) => (
  <div className="truncate font-mono text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{children}</div>
);
const Unit = ({ children }: { children: React.ReactNode }) => (
  <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">{children}</span>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <div className="line-clamp-2 text-xs text-muted-foreground sm:line-clamp-1">{children}</div>
);
const Dash = () => <span className="text-muted-foreground/60">—</span>;
