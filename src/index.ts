import { pingTor, stopTor } from "./tor";
import { search } from "./search";
import { scrapePage } from "./page";

async function main(): Promise<void> {
  const identity = await pingTor();
  console.log(`Connected to Tor.\nIP: ${identity.IP} - IsTor: ${identity.IsTor}`);

  const arg = process.argv[2];
  if (arg && /^https?:\/\//i.test(arg)) {
    const page = await scrapePage(arg);
    console.log(`\n${page.url}\nstatus: ${page.status}\ntitle: ${page.title}`);
    console.log(`\n${page.text}`);
    console.log(`\nlinks: ${page.links.length}`);
    for (const link of page.links) {
      console.log(`  - ${link.title}  (${link.link})`);
    }
  } else {
    const query = arg ?? "data breach";
    console.log(`\nSearching onion engines for: ${query}`);
    const { results, stats } = await search(query);
    console.log(
      `engines: ${stats.enginesOk} ok, ${stats.enginesEmpty} empty, ${stats.enginesFailed} failed; ` +
        `${stats.resultsKept} results`,
    );
    for (const result of results) {
      console.log(`  - ${result.title}  (${result.link})`);
    }
  }

  await stopTor();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});