import { describe, expect, it } from "vitest";
import { OBS_BIN } from "./config";
import { launchArgv } from "./obs-launch";

describe("launchArgv", () => {
  const args = ["--disable-missing-files-check", "--startstreaming"];

  it("runs OBS as its own unit so it outlives the panel", () => {
    expect(launchArgv("uwsm", args)).toEqual(["uwsm", "app", "-t", "service", "-a", "obs", "--", OBS_BIN, ...args]);
    expect(launchArgv("systemd-run", args)).toEqual(["systemd-run", "--user", "--collect", "--quiet", "--", OBS_BIN, ...args]);
  });

  it("falls back to running OBS directly", () => {
    expect(launchArgv("direct", args)).toEqual([OBS_BIN, ...args]);
  });
});
