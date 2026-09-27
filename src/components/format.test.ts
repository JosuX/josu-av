import { describe, expect, it } from "vitest";
import { formatBits, formatBytes, formatDuration } from "./format";

describe("formatBits", () => {
  it("scales by 1000 and keeps one decimal below 10", () => {
    expect(formatBits(0)).toBe("0 bps");
    expect(formatBits(999)).toBe("999 bps");
    expect(formatBits(1500)).toBe("1.5 Kbps");
    expect(formatBits(64_000)).toBe("64 Kbps");
    expect(formatBits(6_000_000)).toBe("6.0 Mbps");
  });
});

describe("formatBytes", () => {
  it("scales by 1024 with a decimal from GiB up", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("2 KiB");
    expect(formatBytes(16 * 1024 ** 3)).toBe("16.0 GiB");
  });
});

describe("formatDuration", () => {
  it("shows the two most significant units", () => {
    expect(formatDuration(5_400)).toBe("5s");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(3_725_000)).toBe("1h 2m");
  });
});
