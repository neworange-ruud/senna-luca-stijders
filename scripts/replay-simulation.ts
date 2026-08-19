import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isReplayFixture, replay } from "./replay.js";

async function main(): Promise<void> {
  const fixtureUrl = process.argv[2]
    ? pathToFileURL(resolve(process.argv[2]))
    : new URL("../tests/fixtures/phase-01-replay.json", import.meta.url);
  const parsed: unknown = JSON.parse(await readFile(fixtureUrl, "utf8"));
  if (!isReplayFixture(parsed)) throw new Error("Replay fixture is invalid.");

  const first = replay(parsed);
  const second = replay(parsed);
  if (first.hash !== second.hash) {
    throw new Error("Deterministic replay hashes differ.");
  }
  console.log(`Fixture: ${fixtureUrl.pathname.split("/").at(-1) ?? ""}`);
  console.log(`Replay A: ${first.hash}`);
  console.log(`Replay B: ${second.hash}`);
  console.log("Identical: yes");
  console.log(`Final: ${first.summary}`);
}

await main();
