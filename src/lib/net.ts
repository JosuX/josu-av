import { networkInterfaces } from "node:os";

// This machine's LAN, as other devices see it.

/** Virtual interfaces (containers, VPNs) whose addresses other LAN devices can't reach. */
const VIRTUAL_IFACE = /^(lo|docker|br-|veth|virbr|vmnet|tailscale|tun|tap|wg|wt|zt)/;

/** The first physical interface with an IPv4 address, e.g. { name: "wlo1", address: "192.168.1.25" }. */
export function lanInterface(): { name: string; address: string } | null {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_IFACE.test(name)) continue;
    const a = addrs?.find((x) => x.family === "IPv4" && !x.internal);
    if (a) return { name, address: a.address };
  }
  return null;
}
