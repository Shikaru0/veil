import { pingTor, stopTor } from "./tor";

async function main(): Promise<void> {
  const identity = await pingTor();
  console.log(`Connected to Tor.\nIP: ${identity.IP} - IsTor: ${identity.IsTor}`);
  await stopTor();
  console.log("Tor sockets closed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});