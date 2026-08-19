import {
  cornerColour,
  crop,
  fitWithin,
  keyBackdrop,
  trim,
  type Colour,
} from "./image-ops.js";
import type { Bitmap } from "./png.js";

/**
 * Row-major names of the 4x4 icon sheet that is generated as one image. A null
 * cell is generated but not shipped: the model drew a second heart where a
 * closed chest was asked for, and one heart is all the game needs.
 */
export const ICON_SHEET: readonly (string | null)[] = [
  "sword",
  "weak-sword",
  "nerf",
  "chest",
  "heart",
  null,
  "armor",
  "speed",
  "camouflage",
  "dart",
  "cosmetic-superhero",
  "cosmetic-soldier",
  "cosmetic-knight",
  "cosmetic-astronaut",
  "cosmetic-pirate",
  "impact",
];

/** Keys the flat generated backdrop, trims the margin, and scales for the canvas. */
export function prepareSprite(
  source: Bitmap,
  longestSide: number,
  key: Colour = cornerColour(source),
): Bitmap {
  return fitWithin(trim(keyBackdrop(source, key)), longestSide);
}

/** Splits a generated contact sheet into equal cells, row by row. */
export function sliceSheet(
  source: Bitmap,
  columns: number,
  rows: number,
): Bitmap[] {
  const cellWidth = Math.floor(source.width / columns);
  const cellHeight = Math.floor(source.height / rows);
  const cells: Bitmap[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push(
        crop(
          source,
          column * cellWidth,
          row * cellHeight,
          cellWidth,
          cellHeight,
        ),
      );
    }
  }
  return cells;
}
