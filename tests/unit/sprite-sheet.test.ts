import { describe, expect, it } from "vitest";

import { createBitmap, keyBackdrop, pixel } from "../../scripts/image-ops";
import {
  buildSpriteSheet,
  findRegions,
  poseRegions,
} from "../../scripts/sprite-sheet";
import type { Bitmap } from "../../scripts/png";

const MAGENTA = { r: 200, g: 60, b: 100 };

interface Blob {
  x: number;
  y: number;
  width: number;
  height: number;
  colour?: { r: number; g: number; b: number };
}

/** A generated pose sheet: a magenta field with drawings on it. */
function sheetWith(blobs: readonly Blob[], size = 120): Bitmap {
  const bitmap = createBitmap(size, size);
  for (let index = 0; index < size * size; index += 1) {
    const offset = index * 4;
    bitmap.data[offset] = MAGENTA.r;
    bitmap.data[offset + 1] = MAGENTA.g;
    bitmap.data[offset + 2] = MAGENTA.b;
    bitmap.data[offset + 3] = 255;
  }
  for (const blob of blobs) {
    const colour = blob.colour ?? { r: 20, g: 30, b: 40 };
    for (let y = blob.y; y < blob.y + blob.height; y += 1) {
      for (let x = blob.x; x < blob.x + blob.width; x += 1) {
        const offset = (y * size + x) * 4;
        bitmap.data[offset] = colour.r;
        bitmap.data[offset + 1] = colour.g;
        bitmap.data[offset + 2] = colour.b;
        bitmap.data[offset + 3] = 255;
      }
    }
  }
  return bitmap;
}

/** Four poses in a two by two grid, the bottom right one a little shorter. */
const FOUR_POSES: readonly Blob[] = [
  { x: 10, y: 10, width: 14, height: 40 },
  { x: 70, y: 10, width: 14, height: 40 },
  { x: 10, y: 70, width: 14, height: 40 },
  { x: 70, y: 70, width: 20, height: 30 },
];

describe("finding the poses in a generated sheet", () => {
  it("reads each drawing as its own region, largest first", () => {
    const keyed = keyBackdrop(sheetWith(FOUR_POSES), MAGENTA);
    const regions = findRegions(keyed);
    expect(regions).toHaveLength(4);
    expect(regions[0]?.pixels).toBeGreaterThanOrEqual(regions[1]?.pixels ?? 0);
  });

  it("puts the poses in reading order", () => {
    const keyed = keyBackdrop(sheetWith(FOUR_POSES), MAGENTA);
    expect(
      poseRegions(keyed, 4).map((pose) => ({ x: pose.x, y: pose.y })),
    ).toEqual([
      { x: 10, y: 10 },
      { x: 70, y: 10 },
      { x: 10, y: 70 },
      { x: 70, y: 70 },
    ]);
  });

  it("leaves out a drop shadow the generator added anyway", () => {
    const withShadow = sheetWith([
      ...FOUR_POSES,
      // A small dark smudge under one pose, well away from it.
      { x: 8, y: 56, width: 18, height: 4, colour: { r: 120, g: 36, b: 60 } },
    ]);
    const keyed = keyBackdrop(withShadow, MAGENTA);
    expect(poseRegions(keyed, 4)).toHaveLength(4);
  });

  it("refuses to build a sheet when a pose is missing", () => {
    const keyed = keyBackdrop(sheetWith(FOUR_POSES.slice(0, 3)), MAGENTA);
    expect(() => buildSpriteSheet(keyed, 40)).toThrow(/found 3/);
  });
});

describe("building a player sheet", () => {
  it("lays the poses out as equal cells on one row", () => {
    const keyed = keyBackdrop(sheetWith(FOUR_POSES), MAGENTA);
    const sheet = buildSpriteSheet(keyed, 40);
    expect(sheet.height).toBe(40);
    expect(sheet.width % 4).toBe(0);
  });

  it("scales every frame by the same factor so nobody changes size", () => {
    const keyed = keyBackdrop(sheetWith(FOUR_POSES), MAGENTA);
    const sheet = buildSpriteSheet(keyed, 40);
    const cell = sheet.width / 4;
    const heightOf = (frame: number): number => {
      let top = sheet.height;
      let bottom = -1;
      for (let y = 0; y < sheet.height; y += 1) {
        for (let x = frame * cell; x < (frame + 1) * cell; x += 1) {
          if (pixel(sheet, x, y)[3]! < 24) continue;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      return bottom - top + 1;
    };
    // The first three poses are the same height in the source, so they must be
    // the same height in the sheet; the shorter fourth one stays shorter.
    expect(heightOf(0)).toBe(heightOf(1));
    expect(heightOf(1)).toBe(heightOf(2));
    expect(heightOf(3)).toBeLessThan(heightOf(0));
  });

  it("stands every frame on the same baseline and centres it", () => {
    const keyed = keyBackdrop(sheetWith(FOUR_POSES), MAGENTA);
    const sheet = buildSpriteSheet(keyed, 40);
    const cell = sheet.width / 4;
    for (let frame = 0; frame < 4; frame += 1) {
      let left = cell;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < sheet.height; y += 1) {
        for (let x = 0; x < cell; x += 1) {
          if (pixel(sheet, frame * cell + x, y)[3]! < 24) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y > bottom) bottom = y;
        }
      }
      // Feet on the floor of the cell, and the same margin on both sides.
      expect(bottom).toBe(sheet.height - 1);
      expect(Math.abs(left - (cell - 1 - right))).toBeLessThanOrEqual(1);
    }
  });
});
