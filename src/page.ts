import * as cheerio from "cheerio";
import { fetchOverTor, randomUserAgent } from "./tor";

/** Maximum bytes read from a single page. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Maximum characters kept for a title. */
export const MAX_TITLE_CHARS = 200;
/** Maximum characters kept for scraped body text. */
const MAX_TEXT_CHARS = 20_000;

/** A host is an onion address only when `.onion` ends the host, not when it appears mid-host. */
export const isOnionHost = (host: string): boolean =>
  host === "onion" || host.endsWith(".onion");

/** Read a response body, stopping once `maxBytes` have been read. */
export async function readCapped(
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

export interface PageLink {
  title: string;
  link: string;
}

export interface ScrapedPage {
  url: string;
  status: number;
  title: string;
  text: string;
  links: PageLink[];
}

/** Fetch an onion (or clearweb) page over Tor and return its title, readable text and onion links. */
export async function scrapePage(url: string): Promise<ScrapedPage> {
  const res = await fetchOverTor(url, { headers: { "User-Agent": randomUserAgent() } });
  const html = new TextDecoder().decode(await readCapped(res.body, MAX_PAGE_BYTES));
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const anchor of $("a").toArray()) {
    const href = $(anchor).attr("href");
    if (!href) continue;
    let target: URL;
    try {
      target = new URL(href, url);
    } catch {
      continue;
    }
    if (!isOnionHost(target.hostname.toLowerCase())) continue;
    const link = target.toString();
    if (seen.has(link)) continue;
    const title = $(anchor).text().replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
    if (title.length < 4 || !/[a-z0-9]/i.test(title)) continue;
    seen.add(link);
    links.push({ title, link });
  }

  return {
    url,
    status: res.status,
    title: $("title").first().text().replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS),
    text: $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS),
    links,
  };
}
