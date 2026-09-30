"use client";

import { VideoOff } from "lucide-react";
import { VideoFeed } from "./VideoFeed";
import { useLive } from "./hooks";
import type { WatchPayload } from "@/lib/shared";

/** The viewer page: the live video, or a notice until the stream starts. */
export function WatchPlayer({ sound = true }: { sound?: boolean }) {
  const { data: state } = useLive<WatchPayload>("watch", "/api/watch");

  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center bg-black p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]">
      {state?.live ? (
        // Kept mounted while live; the player reconnects by itself after a drop.
        <div className="w-full max-w-[min(100%,calc(100dvh*16/9))]">
          <VideoFeed path={state.path} port={state.webrtcPort} source="watch page" sound={sound} />
        </div>
      ) : (
        <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center text-white/70">
          <VideoOff className="size-10" />
          <p className="text-lg font-medium text-white">{state ? "The stream hasn't started" : "Connecting…"}</p>
          {state && <p className="text-sm">It will appear here by itself as soon as it begins. You can leave this page open.</p>}
        </div>
      )}
    </div>
  );
}
