import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import { parseURL } from "./library.mjs";
export function publicAddress(ip) {
  try {
    return ipaddr.process(ip).range() === "unicast";
  } catch {
    return false;
  }
}
export async function safeSession(url, { connections = 4 } = {}) {
  const u = parseURL(url);
  const addresses = await dns.lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("내부·특수 네트워크 주소는 접근할 수 없습니다.");
  const address = addresses.find((a) => a.family === 4) || addresses[0];
  const agent = new Agent({
    connections: Math.min(8, Math.max(1, connections)),
    pipelining: 1,
    headersTimeout: 45_000,
    bodyTimeout: 0,
    connect: {
      timeout: 15_000,
      lookup: (_host, opts, cb) =>
        cb(null, opts.all ? [address] : address.address, address.family),
    },
  });
  return {
    request: (options) =>
      fetch(u, { ...options, dispatcher: agent, redirect: "error" }),
    close: () => agent.destroy(),
  };
}
