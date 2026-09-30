import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Channel } from "./live";

describe("Channel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("loads only while subscribed and sends only changes", async () => {
    let value = 1;
    const load = vi.fn(async () => ({ value }));
    const ch = new Channel(load, 1000);
    expect(load).not.toHaveBeenCalled();

    const got: string[] = [];
    const off = ch.subscribe((j) => got.push(j));
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual(['{"value":1}']);

    await vi.advanceTimersByTimeAsync(3000); // unchanged: nothing new sent
    expect(got).toHaveLength(1);

    value = 2;
    ch.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual(['{"value":1}', '{"value":2}']);

    off();
    const calls = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(load.mock.calls.length).toBe(calls);
  });

  it("gives a late subscriber the latest payload at once", async () => {
    const ch = new Channel(async () => ({ ok: true }), 1000);
    ch.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const late: string[] = [];
    ch.subscribe((j) => late.push(j));
    expect(late).toEqual(['{"ok":true}']);
  });
});
