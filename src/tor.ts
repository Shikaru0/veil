import { fetch, ProxyAgent, type RequestInit, type Response } from "undici";

/** SOCKS5 endpoint of the local Tor daemon. */
export const torSocksUrl = process.env.TOR_SOCKS ?? "socks5://127.0.0.1:9050";

const CONNECT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

// Agent: all fetches route through Tor.
const torAgent = new ProxyAgent({ uri: torSocksUrl, connectTimeout: CONNECT_TIMEOUT_MS });

export interface TorIdentity {
  IsTor: boolean;
  IP: string;
}

/** GET a URL through Tor. Dispatcher, redirects and a request deadline cannot be overridden. */
export function fetchOverTor(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    dispatcher: torAgent,
    redirect: "manual",
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
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

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:137.0) Gecko/20100101 Firefox/137.0",
];

export const randomUserAgent = (): string =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];