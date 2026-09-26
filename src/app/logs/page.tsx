import type { Metadata } from "next";
import { LogMonitor, type LogView } from "@/components/LogMonitor";

export const metadata: Metadata = { title: "Log monitor · AV Control" };

export default async function LogsPage({ searchParams }: PageProps<"/logs">) {
  const { view } = await searchParams;
  const initial: LogView = view === "mediamtx" || view === "ffmpeg" ? view : "split";
  return <LogMonitor initialView={initial} />;
}
