import type { Metadata } from "next";
import { LogMonitor, type LogView } from "@/components/LogMonitor";
import type { LogSource } from "@/components/LogConsole";
import { PROCS, PROC_NAMES } from "@/lib/config";
import { EVENT_LOGS } from "@/lib/shared";

export const metadata: Metadata = { title: "Log monitor · AV Control" };

export default async function LogsPage({ searchParams }: PageProps<"/logs">) {
  const { view } = await searchParams;
  const logs: LogSource[] = [
    ...PROC_NAMES.map((name) => ({ name, label: PROCS[name].shortLabel, kind: "process" as const })),
    ...EVENT_LOGS.map((l) => ({ name: l.name, label: l.label, kind: "events" as const, empty: l.empty })),
  ];
  const initial: LogView = typeof view === "string" && logs.some((l) => l.name === view) ? view : "all";
  return <LogMonitor logs={logs} initialView={initial} />;
}
