import type { Metadata } from "next";
import { LogMonitor, type LogView } from "@/components/LogMonitor";
import { PROCS, PROC_NAMES, isProcName } from "@/lib/config";

export const metadata: Metadata = { title: "Log monitor · AV Control" };

export default async function LogsPage({ searchParams }: PageProps<"/logs">) {
  const { view } = await searchParams;
  const initial: LogView = typeof view === "string" && isProcName(view) ? view : "split";
  const procs = PROC_NAMES.map((name) => ({ name, label: PROCS[name].shortLabel }));
  return <LogMonitor procs={procs} initialView={initial} />;
}
