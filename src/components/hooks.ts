"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProcAction } from "@/lib/shared";
import type { ProcName, StatusPayload } from "./types";

export function useStatus(intervalMs = 2000) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh, intervalMs]);

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
