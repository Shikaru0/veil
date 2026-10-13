import * as cheerio from "cheerio";
import { fetchOverTor, randomUserAgent } from "./tor";

const MAX_SEARCH_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_CHARS = 200;

/** Extraction identifies a page by host, so an .onion label elsewhere in the host is treated as clearweb. */
const isOnionHost = (host: string): boolean =>
  host === "onion" || host.endsWith(".onion");

const hostOf = (url: string): string => new URL(url).hostname.toLowerCase();

/** Onion search engines; `{query}` is where the encoded query goes. */
const ENGINES: ReadonlyArray<{ name: string; url: string }> = [
  { name: "Ahmia", url: "http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/?q={query}" },
  { name: "OnionLand", url: "http://3bbad7fauom4d6sgppalyqddsqbf5u5p56b5k5uk2zxsy3d6ey2jobad.onion/search?q={query}" },
  { name: "Tor66", url: "http://tor66sewebgixwhcqfnp5inzp5x5uohhdy3kvtnyfxc2e5mxiuh34iid.onion/search?q={query}" },
  { name: "TheDeepSearches", url: "http://searchgf7gdtauh7bhnbyed4ivxqmuoat3nm6zfrg3ymkq6mtnpye3ad.onion/search?q={query}" },
  { name: "Amnesia", url: "http://amnesia7u5odx5xbwtpnqk3edybgud5bmiagu75bnqx2crntw5kry7ad.onion/search?query={query}" },
  { name: "Kaizer", url: "http://kaizerwfvp5gxu6cppibp7jhcqptavq3iqef66wbxenh6a2fklibdvid.onion/search?q={query}" },
  { name: "Torgle", url: "http://iy3544gmoeclh5de6gez2256v6pjh4omhpqdh2wpeeppjtvqmjhkfwad.onion/torgle/?query={query}" },
  { name: "TorNet", url: "http://tornetupfu7gcgidt33ftnungxzyfq2pygui5qdoyss34xbgx2qruzid.onion/search?q={query}" },
  { name: "FindTor", url: "http://findtorroveq5wdnipkaojfpqulxnkhblymc7aramjzajcvpptd4rjqd.onion/search?q={query}" },
  { name: "Torgol", url: "http://torgolnpeouim56dykfob6jh5r2ps2j73enc42s2um4ufob3ny4fcdyd.onion/?q={query}" },
];

// A result on one engine is another engine's page, not a target.
const ENGINE_HOSTS = new Set(ENGINES.map((engine) => hostOf(engine.url)));

export interface SearchResult {
  title: string;
  link: string;
}

export type EngineStatus = "ok" | "empty" | "failed";

export interface SearchResponse {
  results: SearchResult[];
  stats: {
    enginesQueried: number;
    enginesOk: number;
    enginesEmpty: number;
    enginesFailed: number;
    resultsRaw: number;
    resultsKept: number;
    engines: Array<{ name: string; status: EngineStatus; results: number; error: string }>;
  };
}

interface EngineOutcome {
  status: EngineStatus;
  links: SearchResult[];
  error: string;
}

async function readCapped(
  body: AsyncIterable<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.from(chunk);
    const room = maxBytes - total;
    if (buf.length >= room) {
      chunks.push(buf.subarray(0, room));
      break;
    }
    chunks.push(buf);
    total += buf.length;
  }
  return Buffer.concat(chunks);
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function extractLinks(html: string, engineUrl: string): SearchResult[] {
  const $ = cheerio.load(html);
  const links: SearchResult[] = [];

  for (const anchor of $("a").toArray()) {
    const element = $(anchor);
    const href = element.attr("href");
    if (!href) continue;

    let url: URL;
    try {
      url = new URL(href, engineUrl);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (!isOnionHost(host) || ENGINE_HOSTS.has(host)) continue;

    const title = element.text().replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
    if (title.length < 4 || !/[a-z0-9]/i.test(title)) continue;
    links.push({ title, link: url.toString() });
  }
  return links;
}

async function queryEngine(url: string): Promise<EngineOutcome> {
  try {
    const res = await fetchOverTor(url, { headers: { "User-Agent": randomUserAgent() } });
    if (res.status !== 200) {
      return { status: "failed", links: [], error: `http ${res.status}` };
    }
    const html = new TextDecoder().decode(await readCapped(res.body, MAX_SEARCH_PAGE_BYTES));
    const links = extractLinks(html, url);
    return { status: links.length ? "ok" : "empty", links, error: "" };
  } catch (error) {
    return {
      status: "failed",
      links: [],
      error: String(error instanceof Error ? error.message : error).slice(0, 200),
    };
  }
}

/** Query the onion search engines for `query` and collect deduplicated hits. */
export async function search(query: string, maxWorkers = 5): Promise<SearchResponse> {
  const encoded = encodeURIComponent(query ?? "");
  const outcomes = await mapPool(ENGINES, maxWorkers, (engine) =>
    queryEngine(engine.url.replace("{query}", encoded)),
  );

  const raw: SearchResult[] = outcomes.flatMap((outcome) => outcome.links);
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const result of raw) {
    let key: string;
    try {
      const url = new URL(result.link);
      key = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}?${url.searchParams.toString()}`;
    } catch {
      key = result.link;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(result);
  }

  const engines = ENGINES.map((engine, index) => ({
    name: engine.name,
    status: outcomes[index].status,
    results: outcomes[index].links.length,
    error: outcomes[index].error,
  }));

  return {
    results,
    stats: {
      enginesQueried: ENGINES.length,
      enginesOk: engines.filter((e) => e.status === "ok").length,
      enginesEmpty: engines.filter((e) => e.status === "empty").length,
      enginesFailed: engines.filter((e) => e.status === "failed").length,
      resultsRaw: raw.length,
      resultsKept: results.length,
      engines,
    },
  };
}