import "server-only";
import { getObsPayload, getStatus, getWatch } from "./payloads";
import { procman } from "./procman";
import { supervisor } from "./supervisor";

// Live push for the UI. Each topic is computed once and sent to every open page (over
// /api/events/<topic>), instead of every page polling on its own. A topic only runs while
// someone is subscribed, and only sends when its payload changed.

export const TOPICS = ["status", "obs", "automation", "watch"] as const;
export type Topic = (typeof TOPICS)[number];

export function isTopic(s: string): s is Topic {
  return (TOPICS as readonly string[]).includes(s);
}

export class Channel {
  private subs = new Set<(json: string) => void>();
  private last: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private loading = false;
  private again = false;

  constructor(
    private readonly load: () => Promise<unknown>,
    private readonly everyMs: number,
  ) {}

  get subscribers() {
    return this.subs.size;
  }

  /** Receive the latest payload now (if there is one) and every change after it. */
  subscribe(fn: (json: string) => void): () => void {
    this.subs.add(fn);
    if (this.last) fn(this.last);
    if (this.subs.size === 1) {
      this.timer = setInterval(() => void this.refresh(), this.everyMs);
      this.timer.unref();
      void this.refresh();
    }
    return () => {
      this.subs.delete(fn);
      if (this.subs.size || !this.timer) return;
      clearInterval(this.timer);
      this.timer = null;
      this.last = null;
    };
  }

  /** Recompute now, e.g. because something just changed. */
  poke() {
    if (this.subs.size) void this.refresh();
  }

  async refresh() {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    try {
      const json = JSON.stringify(await this.load());
      if (json !== this.last && this.subs.size) {
        this.last = json;
        for (const fn of this.subs) fn(json);
      }
    } catch (e) {
      console.error("[live] update failed", e);
    } finally {
      this.loading = false;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    }
  }
}

function createChannels(): Record<Topic, Channel> {
  const channels: Record<Topic, Channel> = {
    status: new Channel(getStatus, 2000),
    // Talks to OBS (and reads its profile), so a little less often.
    obs: new Channel(getObsPayload, 3000),
    // Changes with each supervisor check (poked below); the interval is only a fallback.
    automation: new Channel(async () => supervisor.payload(), 10_000),
    watch: new Channel(getWatch, 3000),
  };
  for (const p of Object.values(procman.procs)) p.on("state", () => channels.status.poke());
  supervisor.onTick(() => {
    channels.automation.poke();
    channels.status.poke();
  });
  return channels;
}

const g = globalThis as unknown as { __avLive?: Record<Topic, Channel> };
export const live = (g.__avLive ??= createChannels());
