import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_SHEET, prepareSprite, sliceSheet } from "./asset-pipeline.js";
import { cornerColour, resize } from "./image-ops.js";
import { decodePng, encodePng, type Bitmap } from "./png.js";

/**
 * Turns the raw Layer MCP generations in `assets/source` into the runtime
 * artwork under `public/art`. Generation itself is a manual, price-estimated
 * MCP step; this script is the repeatable part, so regenerating one source
 * image and rerunning `npm run assets` reproduces every derived file exactly.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "assets/source");
const TARGET = resolve(ROOT, "public/art");

function read(name: string): Bitmap {
  return decodePng(readFileSync(resolve(SOURCE, name)));
}

function write(relativePath: string, bitmap: Bitmap): void {
  const file = resolve(TARGET, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodePng(bitmap));
  console.log(`${relativePath}: ${bitmap.width}x${bitmap.height}`);
}

const sheet = read("icons-sheet.png");
const key = cornerColour(sheet);
console.log(`Keying backdrop rgb(${key.r}, ${key.g}, ${key.b}).`);

write("sprites/luca.png", prepareSprite(read("luca.png"), 384));
write("sprites/senna.png", prepareSprite(read("senna.png"), 384));

sliceSheet(sheet, 4, 4).forEach((cell, index) => {
  const name = ICON_SHEET[index];
  if (name) write(`icons/${name}.png`, prepareSprite(cell, 128));
});

for (const world of [
  "beach",
  "forest",
  "space",
  "construction",
  "city",
  "boat",
]) {
  const backdrop = read(`world-${world}.png`);
  write(
    `worlds/${world}.png`,
    resize(
      backdrop,
      1_024,
      Math.round((backdrop.height / backdrop.width) * 1_024),
    ),
  );
}
