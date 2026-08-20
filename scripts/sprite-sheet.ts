import { PLAYER_FRAMES } from "../src/client/sprite-animation.js";
import { createBitmap, crop, resize } from "./image-ops.js";
import type { Bitmap } from "./png.js";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

const OPAQUE = 24;

/**
 * Finds every separate drawing in a keyed image, largest first.
 *
 * A generated pose sheet is never a perfect grid: the poses sit wherever the
 * model put them and often come with a drop shadow the prompt asked it not to
 * draw. Reading the outlines instead of assuming a grid handles both, and the
 * shadow is then simply a small region that gets dropped.
 */
export function findRegions(source: Bitmap): Region[] {
  const seen = new Uint8Array(source.width * source.height);
  const regions: Region[] = [];
  const opaque = (index: number): boolean =>
    source.data[index * 4 + 3]! >= OPAQUE;

  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] === 1 || !opaque(start)) continue;
    let minimumX = source.width;
    let minimumY = source.height;
    let maximumX = -1;
    let maximumY = -1;
    let pixels = 0;
    // An explicit stack rather than recursion: a full-height character is tens
    // of thousands of pixels deep and would overflow the call stack.
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % source.width;
      const y = Math.floor(index / source.width);
      pixels += 1;
      if (x < minimumX) minimumX = x;
      if (x > maximumX) maximumX = x;
      if (y < minimumY) minimumY = y;
      if (y > maximumY) maximumY = y;
      for (const [stepX, stepY] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nextX = x + stepX;
        const nextY = y + stepY;
        if (
          nextX < 0 ||
          nextY < 0 ||
          nextX >= source.width ||
          nextY >= source.height
        ) {
          continue;
        }
        const next = nextY * source.width + nextX;
        if (seen[next] === 1 || !opaque(next)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    regions.push({
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
      pixels,
    });
  }
  return regions.sort((first, second) => second.pixels - first.pixels);
}

/**
 * The poses in reading order: top row left to right, then the bottom row.
 * Anything much smaller than the poses themselves is a shadow or a speck and is
 * left out.
 */
export function poseRegions(source: Bitmap, expected: number): Region[] {
  const regions = findRegions(source);
  const largest = regions[0];
  if (!largest) return [];
  const poses = regions
    .filter((region) => region.pixels >= largest.pixels * 0.25)
    .slice(0, expected);
  const rowHeight = largest.height;
  return poses.sort((first, second) => {
    const firstRow = Math.round(first.y / rowHeight);
    const secondRow = Math.round(second.y / rowHeight);
    if (firstRow !== secondRow) return firstRow - secondRow;
    return first.x - second.x;
  });
}

/**
 * Lays the poses out as one horizontal strip of equal cells.
 *
 * Every frame is scaled by the same factor, so the character never changes size
 * from one frame to the next, and every frame is centred on its own width and
 * stood on a shared baseline, so the feet stay put while it walks.
 */
export function buildSpriteSheet(
  source: Bitmap,
  cellHeight: number,
  frameCount: number = PLAYER_FRAMES.length,
): Bitmap {
  const poses = poseRegions(source, frameCount);
  if (poses.length !== frameCount) {
    throw new Error(
      `Expected ${frameCount} poses in the sheet, found ${poses.length}.`,
    );
  }
  const tallest = Math.max(...poses.map((pose) => pose.height));
  const widest = Math.max(...poses.map((pose) => pose.width));
  const scale = cellHeight / tallest;
  const cellWidth = Math.max(1, Math.ceil(widest * scale));
  const sheet = createBitmap(cellWidth * frameCount, cellHeight);

  poses.forEach((pose, index) => {
    const width = Math.max(1, Math.round(pose.width * scale));
    const height = Math.max(1, Math.round(pose.height * scale));
    const frame = resize(
      crop(source, pose.x, pose.y, pose.width, pose.height),
      width,
      height,
    );
    const offsetX = index * cellWidth + Math.round((cellWidth - width) / 2);
    const offsetY = cellHeight - height;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const from = (y * width + x) * 4;
        const to = ((offsetY + y) * sheet.width + offsetX + x) * 4;
        sheet.data[to] = frame.data[from]!;
        sheet.data[to + 1] = frame.data[from + 1]!;
        sheet.data[to + 2] = frame.data[from + 2]!;
        sheet.data[to + 3] = frame.data[from + 3]!;
      }
    }
  });
  return sheet;
}
