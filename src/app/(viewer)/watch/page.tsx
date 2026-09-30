import type { Metadata } from "next";
import { WatchPlayer } from "@/components/WatchPlayer";

export const metadata: Metadata = { title: "Live stream" };

export default function WatchPage() {
  return <WatchPlayer />;
}
