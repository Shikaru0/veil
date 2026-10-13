import { fetch, ProxyAgent, type RequestInit, type Response } from "undici";

/** SOCKS5 endpoint of the local Tor daemon. */
export const torSocksUrl = process.env.TOR_SOCKS ?? "socks5://127.0.0.1:9050";

const CONNECT_TIMEOUT_MS = 30_000;

// Agent: all fetches route through Tor.
const torAgent = new ProxyAgent({ uri: torSocksUrl, connectTimeout: CONNECT_TIMEOUT_MS });

export interface TorIdentity {
  IsTor: boolean;
  IP: string;
}

/** GET a URL through Tor. */
export function fetchOverTor(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, dispatcher: torAgent, redirect: "manual" });
}

/** Make a request through Tor and report the egress identity observed. */
export async function pingTor(): Promise<TorIdentity> {
  const res = await fetchOverTor("https://check.torproject.org/api/ip");
  if (!res.ok) throw new Error(`check.torproject.org replied HTTP ${res.status}`);
  return (await res.json()) as TorIdentity;
}

/** Close the Tor sockets. */
export function stopTor(): Promise<void> {
  return torAgent.close();
}