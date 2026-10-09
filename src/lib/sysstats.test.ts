import { describe, expect, it } from "vitest";
import { parseDefaultIface, parseMeminfo, parseNetDev, parseNetstatE } from "./sysstats";

const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0
enp3s0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0
enp3s0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
`;

const DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
enp3s0: 123456 100 0 0 0 0 0 0 654321 200 0 0 0 0 0 0
`;

describe("parseDefaultIface", () => {
  it("picks the default route with the lowest metric", () => {
    expect(parseDefaultIface(ROUTE)).toBe("enp3s0");
  });

  it("returns null without a default route", () => {
    expect(parseDefaultIface(ROUTE.split("\n").slice(0, 1).join("\n"))).toBeNull();
  });
});

describe("parseNetDev", () => {
  it("reads the rx and tx byte counters", () => {
    expect(parseNetDev(DEV, "enp3s0")).toEqual({ rx: 123456, tx: 654321 });
  });

  it("returns null for an unknown interface", () => {
    expect(parseNetDev(DEV, "eth9")).toBeNull();
  });
});

describe("parseMeminfo", () => {
  it("computes used as total minus available", () => {
    const txt = "MemTotal:       16000 kB\nMemFree:         2000 kB\nMemAvailable:    6000 kB\n";
    expect(parseMeminfo(txt)).toEqual({ total: 16000 * 1024, used: 10000 * 1024 });
  });
});

describe("parseNetstatE", () => {
  it("reads the received and sent byte totals", () => {
    const out = `Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                    2430303638       878875170\r\nUnicast packets           154999935        96221589\r\n`;
    expect(parseNetstatE(out)).toEqual({ rx: 2430303638, tx: 878875170 });
  });
});
