import type { Metadata } from "next";
import { WatchPlayer } from "@/components/WatchPlayer";

export const metadata: Metadata = { title: "Live stream" };

/** `?muted` starts without sound, e.g. when the dashboard embeds the page as a preview. */
export default async function WatchPage({ searchParams }: PageProps<"/watch">) {
  const { muted } = await searchParams;
  return <WatchPlayer sound={muted === undefined} />;
}
