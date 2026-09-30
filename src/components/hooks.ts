"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProcAction } from "@/lib/shared";
import type { ProcName, StatusPayload } from "./types";

/** While the live stream is down, re-read the data this often. */
const FALLBACK_POLL_MS = 3000;

/**
 * Data pushed live from /api/events/<topic>, with `refresh` to re-read it from `url` at once
 * (e.g. right after an action). EventSource reconnects by itself after a drop; until it does,
 * the data is polled from `url`, so the page keeps updating either way.
 */
export function useLive<T>(topic: string, url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
    const first = setTimeout(refresh, 0);
    const es = new EventSource(`/api/events/${topic}`);
    es.addEventListener("data", (e) => {
      stopPolling();
      setData(JSON.parse((e as MessageEvent<string>).data));
      setError(null);
    });
    es.onerror = () => {
      poll ??= setInterval(refresh, FALLBACK_POLL_MS);
    };
    return () => {
      clearTimeout(first);
      stopPolling();
      es.close();
    };
  }, [topic, refresh]);

  return { data, setData, error, refresh };
}

export function useStatus() {
  const { data: status, error, refresh } = useLive<StatusPayload>("status", "/api/status");
  return { status, error, refresh };
}

export type { ProcAction };

export async function fetchStatus(): Promise<StatusPayload> {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function procAction(name: ProcName, action: ProcAction): Promise<boolean> {
  try {
    const res = await fetch(`/api/process/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast.error(data.error ?? `Failed to ${action} ${name}`);
      return false;
    }
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

/** Re-render periodically, e.g. for uptime counters. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
