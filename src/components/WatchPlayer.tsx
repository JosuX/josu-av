"use client";

import { AnimatePresence, motion } from "motion/react";
import { RadioTower } from "lucide-react";
import { VideoFeed } from "./VideoFeed";
import { useLive } from "./hooks";
import { EASE } from "./motion";
import Aurora from "./reactbits/Aurora";
import ShinyText from "./reactbits/ShinyText";
import type { WatchPayload } from "@/lib/shared";

/** The viewer page: the live video, or a calm waiting screen until the stream starts. */
export function WatchPlayer({ sound = true }: { sound?: boolean }) {
  const { data: state } = useLive<WatchPayload>("watch", "/api/watch");
  const live = !!state?.live;

  return (
    <div className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden bg-black p-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]">
      <AnimatePresence mode="wait">
        {live ? (
          // Kept mounted while live; the player reconnects by itself after a drop.
          <motion.div
            key="live"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="w-full max-w-[min(100%,calc(100dvh*16/9))]"
          >
            <VideoFeed path={state!.path} port={state!.webrtcPort} source="watch page" sound={sound} />
          </motion.div>
        ) : (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="absolute inset-0 opacity-60" aria-hidden>
              <Aurora colorStops={["#1d4ed8", "#7c3aed", "#0891b2"]} amplitude={0.8} blend={0.6} speed={0.6} />
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/80" aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.15 }}
              className="relative flex max-w-sm flex-col items-center gap-4 px-6 text-center"
            >
              <span className="grid size-14 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                <RadioTower className="size-6 text-white/80" />
              </span>
              {state ? (
                <>
                  <p className="text-xl font-semibold tracking-tight text-white">The stream hasn&apos;t started</p>
                  <ShinyText
                    text="It will appear here by itself as soon as it begins. You can leave this page open."
                    className="text-sm"
                    color="rgba(255,255,255,0.55)"
                    shineColor="rgba(255,255,255,0.95)"
                    speed={4}
                  />
                </>
              ) : (
                <ShinyText text="Connecting…" className="text-lg font-medium" color="rgba(255,255,255,0.55)" shineColor="#fff" speed={2} />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
