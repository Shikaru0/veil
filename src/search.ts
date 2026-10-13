import * as cheerio from "cheerio";
import { fetchOverTor, randomUserAgent, rotateCircuit } from "./tor";
import { MAX_PAGE_BYTES, MAX_TITLE_CHARS, isOnionHost, readCapped } from "./page";

const hostOf = (url: string): string => new URL(url).hostname.toLowerCase();

/** Ahmia hides each result behind /search/redirect?redirect_url=<target>. */
function unwrapRedirect(url: URL): URL | null {
  const target = url.searchParams.get("redirect_url");
  if (!target) return null;
  try {
    const parsed = new URL(target);
    return isOnionHost(parsed.hostname.toLowerCase()) ? parsed : null;
  } catch {
    return null;
  }
}

interface Engine {
  name: string;
  url: string;
  /** Homepage serves a hidden token the search URL must carry. */
  tokenGated?: boolean;
}

/** Onion search engines; `{query}` is where the encoded query goes. */
const ENGINES: ReadonlyArray<Engine> = [
  { name: "Ahmia", url: "http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/?q={query}", tokenGated: true },
  { name: "OnionLand", url: "http://3bbad7fauom4d6sgppalyqddsqbf5u5p56b5k5uk2zxsy3d6ey2jobad.onion/search?q={query}" },
  { name: "Tor66", url: "http://tor66sewebgixwhcqfnp5inzp5x5uohhdy3kvtnyfxc2e5mxiuh34iid.onion/search?q={query}" },
  { name: "TheDeepSearches", url: "http://searchgf7gdtauh7bhnbyed4ivxqmuoat3nm6zfrg3ymkq6mtnpye3ad.onion/search?q={query}" },
  { name: "Amnesia", url: "http://amnesia7u5odx5xbwtpnqk3edybgud5bmiagu75bnqx2crntw5kry7ad.onion/search?query={query}" },
  { name: "Torgle", url: "http://iy3544gmoeclh5de6gez2256v6pjh4omhpqdh2wpeeppjtvqmjhkfwad.onion/torgle/?query={query}" },
  { name: "TorNet", url: "http://tornetupfu7gcgidt33ftnungxzyfq2pygui5qdoyss34xbgx2qruzid.onion/search?q={query}" },
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
    if (ENGINE_HOSTS.has(host)) {
      const target = unwrapRedirect(url);
      if (!target) continue;
      url = target;
    } else if (!isOnionHost(host)) {
      continue;
    }

    const title = element.text().replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
    if (title.length < 4 || !/[a-z0-9]/i.test(title)) continue;
    links.push({ title, link: url.toString() });
  }
  return links;
}

/** undici reports any transport failure as "fetch failed"; the real reason
 * (connect timeout, SOCKS5 refusal, connection reset) is in `.cause`. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 200);
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : cause != null ? String(cause) : "";
  return `${error.message}${detail ? `: ${detail}` : ""}`.slice(0, 200);
}

/** Engines flagged `tokenGated` need a hidden token from their homepage added to the query. */
async function tokenGatedUrl(engineUrl: string, encodedQuery: string): Promise<string> {
  const res = await fetchOverTor(`${new URL(engineUrl).origin}/`, {
    headers: { "User-Agent": randomUserAgent() },
  });
  if (res.status !== 200) throw new Error(`home http ${res.status}`);
  const html = new TextDecoder().decode(await readCapped(res.body, MAX_PAGE_BYTES));
  const token = html.match(/<input type="hidden" name="([^"]+)" value="([^"]*)"/);
  if (!token) throw new Error("search token not found");
  return `${engineUrl.replace("{query}", encodedQuery)}&${token[1]}=${encodeURIComponent(token[2])}`;
}

async function queryEngine(engine: Engine, encodedQuery: string): Promise<EngineOutcome> {
  try {
    const url = engine.tokenGated
      ? await tokenGatedUrl(engine.url, encodedQuery)
      : engine.url.replace("{query}", encodedQuery);
    const res = await fetchOverTor(url, { headers: { "User-Agent": randomUserAgent() } });
    if (res.status !== 200) {
      return { status: "failed", links: [], error: `http ${res.status}` };
    }
    const html = new TextDecoder().decode(await readCapped(res.body, MAX_PAGE_BYTES));
    const links = extractLinks(html, url);
    return { status: links.length ? "ok" : "empty", links, error: "" };
  } catch (error) {
    return { status: "failed", links: [], error: describeError(error) };
  }
}

/** Query the onion search engines for `query` and collect deduplicated hits. */
export async function search(query: string, maxWorkers = 5): Promise<SearchResponse> {
  const encoded = encodeURIComponent(query ?? "");

  const outcomes = await mapPool(ENGINES, maxWorkers, (engine) => queryEngine(engine, encoded));

  // A failure is usually a dead exit; one retry on a fresh circuit recovers most.
  const failed = outcomes.flatMap((outcome, index) => (outcome.status === "failed" ? [index] : []));
  if (failed.length) {
    await rotateCircuit();
    const retried = await mapPool(failed, maxWorkers, (index) => queryEngine(ENGINES[index], encoded));
    failed.forEach((index, position) => {
      if (retried[position].status !== "failed") outcomes[index] = retried[position];
    });
  }

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