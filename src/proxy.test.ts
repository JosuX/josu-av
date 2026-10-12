import { describe, expect, it } from "vitest";
import { isCrossSiteWrite } from "./proxy";

describe("isCrossSiteWrite", () => {
  it("lets the panel's own pages write", () => {
    expect(isCrossSiteWrite("POST", "http://192.168.1.10:3000", "192.168.1.10:3000")).toBe(false);
    expect(isCrossSiteWrite("POST", "http://127.0.0.1:8080", "127.0.0.1:8080")).toBe(false);
  });

  it("lets requests without a browser through", () => {
    expect(isCrossSiteWrite("POST", null, "127.0.0.1:3000")).toBe(false);
  });

  it("allows reads from anywhere", () => {
    expect(isCrossSiteWrite("GET", "https://evil.example", "127.0.0.1:3000")).toBe(false);
  });

  it("refuses writes from other sites, ports and opaque origins", () => {
    expect(isCrossSiteWrite("POST", "https://evil.example", "127.0.0.1:3000")).toBe(true);
    expect(isCrossSiteWrite("DELETE", "http://127.0.0.1:5173", "127.0.0.1:3000")).toBe(true);
    expect(isCrossSiteWrite("POST", "null", "127.0.0.1:3000")).toBe(true);
  });
});
