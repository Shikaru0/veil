import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search } from "./search";
import { scrapePage } from "./page";

async function main(): Promise<void> {
  const server = new McpServer({ name: "veil", version: "1.0.0" });

  server.registerTool(
    "search",
    {
      title: "Search onion services",
      description:
        "Search dark-web (.onion) search engines and return deduplicated .onion results with their titles.",
      inputSchema: { query: z.string().describe("Search terms") },
    },
    async ({ query }) => {
      const { results, stats } = await search(query);
      const body = results.map((result) => `- ${result.title} (${result.link})`).join("\n");
      return {
        content: [
          {
            type: "text",
            text:
              `${stats.resultsKept} results ` +
              `(${stats.enginesOk} engines ok, ${stats.enginesEmpty} empty, ${stats.enginesFailed} failed)\n\n` +
              body,
          },
        ],
      };
    },
  );

  server.registerTool(
    "scrape",
    {
      title: "Fetch a page over Tor",
      description:
        "Fetch an .onion URL through Tor and return its status, title, readable text and .onion links.",
      inputSchema: { url: z.string().describe("URL to fetch, e.g. http://<address>.onion/") },
    },
    async ({ url }) => {
      const page = await scrapePage(url);
      const links = page.links.map((link) => `- ${link.title} (${link.link})`).join("\n");
      return {
        content: [
          {
            type: "text",
            text: `status: ${page.status}\ntitle: ${page.title}\n\n${page.text}\n\nlinks:\n${links}`,
          },
        ],
      };
    },
  );

  await server.connect(new StdioServerTransport());
  console.error("veil MCP server listening on stdio");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
