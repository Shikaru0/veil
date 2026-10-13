import { pingTor, stopTor } from "./tor";
import { search } from "./search";

async function main(): Promise<void> {
  const identity = await pingTor();
  console.log(`Connected to Tor.\nIP: ${identity.IP} - IsTor: ${identity.IsTor}`);

  const query = process.argv[2] ?? "data breach";
  console.log(`\nSearching onion engines for: ${query}`);
  const { results, stats } = await search(query);

  console.log(
    `engines: ${stats.enginesOk} ok, ${stats.enginesEmpty} empty, ${stats.enginesFailed} failed; ` +
      `${stats.resultsKept} results`,
  );
  for (const result of results.slice(0, 10)) {
    console.log(`  - ${result.title}  (${result.link})`);
  }

  await stopTor();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});