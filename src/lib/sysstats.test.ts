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
  const NETSTAT = `Interface Statistics\r
\r
                           Received            Sent\r
\r
Bytes                    3001207712      475301938\r
Unicast packets             2903491        1625401\r
Non-unicast packets           13874          11312\r
`;

  it("reads the byte counters, whatever the row is called", () => {
    expect(parseNetstatE(NETSTAT)).toEqual({ rx: 3001207712, tx: 475301938 });
    expect(parseNetstatE(NETSTAT.replace("Bytes", "Octets"))).toEqual({ rx: 3001207712, tx: 475301938 });
  });

  it("returns null without counters", () => {
    expect(parseNetstatE("")).toBeNull();
  });
});
