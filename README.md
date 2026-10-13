# veil

Read-only OSINT over Tor: aggregates `.onion` search engines and scrapes onion pages, exposed as a CLI and a local MCP server.

## Requirements

- Node.js 22.19+ (undici, used for SOCKS5, requires it)
- A local Tor daemon with a SOCKS5 listener (default `127.0.0.1:9050`)

## Setup

```sh
npm install # Install necessary dependencies
```

Override the SOCKS5 endpoint with `TOR_SOCKS` if your daemon listens elsewhere:

```sh
TOR_SOCKS=socks5://127.0.0.1:9150 npm run dev -- "query"
```

## CLI

```sh
npm run dev -- "<query>"    # <query> is the text you want to search for
npm run dev -- "<address>"  # <address> is the .onion address to scrape
```

`<query>` is just the text you want to search for; `<address>` is the `.onion` address to scrape (`http://` is assumed if omitted).

Search queries multiple onion search engines and returns one result per onion service (pages of the same service are collapsed). 
Scrape returns the status, title, readable text and deduplicated `.onion` links.

## MCP server

`npm run mcp` starts a stdio MCP server exposing two tools:

- `search` — `search(query)` — onion engine results.
- `scrape` — `scrapePage(url)` — status, title, text and onion links for a URL.

Register it with any MCP client (opencode, Claude Code, Codex). 
Example for opencode's config:

```json
{
  "mcp": {
    "servers": {
      "veil": {
        "type": "local",
        "command": ["npx", "tsx", "src/mcp.ts"],
        "cwd": "/path/to/veil"
      }
    }
  }
}
```

## Structure

| File | Purpose |
| --- | --- |
| `src/tor.ts` | Tor transport: `fetchOverTor`, circuit rotation, identity ping. |
| `src/search.ts` | Onion search engine aggregation. |
| `src/page.ts` | Page fetching/extraction primitives and `scrapePage`. |
| `src/index.ts` | CLI entry point. |
| `src/mcp.ts` | MCP server entry point. |

## Notes

- All requests route through Tor; failed engines are retried once on a fresh circuit.
- Circuit rotation uses per-request SOCKS credentials, so no Tor control port is needed.
