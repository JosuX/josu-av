import { describe, expect, it } from "vitest";
import { deviceLabel, formatBits, formatBytes, formatDuration } from "./format";

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

describe("deviceLabel", () => {
  it.each([
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "iPad · Safari"],
    ["Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", "Android · Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0", "Windows · Edge"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Linux · Firefox"],
  ])("%s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});
