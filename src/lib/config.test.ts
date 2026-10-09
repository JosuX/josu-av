import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apiListenAddress, defaultMediamtxConfig, findOnPath } from "./config";

describe("apiListenAddress", () => {
  it("keeps host and port", () => {
    expect(apiListenAddress("http://127.0.0.1:9997")).toBe("127.0.0.1:9997");
    expect(apiListenAddress("http://[::1]:9000/")).toBe("[::1]:9000");
  });

  it("spells out the default port", () => {
    expect(apiListenAddress("http://localhost")).toBe("localhost:80");
    expect(apiListenAddress("https://mtx.local")).toBe("mtx.local:443");
  });
});

describe("findOnPath", () => {
  it("finds a binary in a PATH directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "av-path-"));
    const name = process.platform === "win32" ? "fakebin.exe" : "fakebin";
    writeFileSync(path.join(dir, name), "");
    const env = { PATH: dir, PATHEXT: ".EXE" };
    expect(findOnPath("fakebin", env)).toBe(path.join(dir, name));
    expect(findOnPath("missing", env)).toBeNull();
  });
});

describe.runIf(process.platform === "win32")("defaultMediamtxConfig (Windows)", () => {
  it("uses the mediamtx.yml next to mediamtx.exe", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "av-mtx-"));
    writeFileSync(path.join(dir, "mediamtx.exe"), "");
    const env = { PATH: dir, PATHEXT: ".EXE" };
    expect(defaultMediamtxConfig("mediamtx", env)).toBeNull();
    writeFileSync(path.join(dir, "mediamtx.yml"), "");
    expect(defaultMediamtxConfig("mediamtx", env)).toBe(path.join(dir, "mediamtx.yml"));
  });
});
