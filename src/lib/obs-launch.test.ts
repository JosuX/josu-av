import { describe, expect, it } from "vitest";
import { launchArgv } from "./obs-launch";

describe("launchArgv", () => {
  const args = ["--disable-missing-files-check", "--startstreaming"];

  it("runs OBS as its own unit so it outlives the panel", () => {
    expect(launchArgv("uwsm", args)).toEqual(["uwsm", "app", "-t", "service", "-a", "obs", "--", "obs", ...args]);
    expect(launchArgv("systemd-run", args)).toEqual(["systemd-run", "--user", "--collect", "--quiet", "--", "obs", ...args]);
  });

  it("falls back to running OBS directly", () => {
    expect(launchArgv("direct", args)).toEqual(["obs", ...args]);
  });
});
