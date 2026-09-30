import { describe, expect, it } from "vitest";
import { apiListenAddress } from "./config";

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
