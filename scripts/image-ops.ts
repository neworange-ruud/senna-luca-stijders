import type { Bitmap } from "./png.js";

export interface Colour {
  r: number;
  g: number;
  b: number;
}

export function pixel(bitmap: Bitmap, x: number, y: number): number[] {
  const offset = (y * bitmap.width + x) * 4;
  return [
    bitmap.data[offset]!,
    bitmap.data[offset + 1]!,
    bitmap.data[offset + 2]!,
    bitmap.data[offset + 3]!,
  ];
}

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function crop(
  bitmap: Bitmap,
  x: number,
  y: number,
  width: number,
  height: number,
): Bitmap {
  const result = createBitmap(width, height);
  for (let row = 0; row < height; row += 1) {
    const source = ((y + row) * bitmap.width + x) * 4;
    result.data.set(
      bitmap.data.subarray(source, source + width * 4),
      row * width * 4,
    );
  }
  return result;
}

function distanceTo(bitmap: Bitmap, index: number, key: Colour): number {
  const offset = index * 4;
  return Math.sqrt(
    (bitmap.data[offset]! - key.r) ** 2 +
      (bitmap.data[offset + 1]! - key.g) ** 2 +
      (bitmap.data[offset + 2]! - key.b) ** 2,
  );
}

/**
 * Replaces the generated flat backdrop with transparency.
 *
 * A plain colour-distance test cannot separate backdrop from artwork, because
 * generated art contains colours close to the backdrop (a coral shirt next to a
 * magenta screen). Instead the backdrop is grown as a region: it starts from
 * pixels that are unmistakably the key colour and spreads only through
 * neighbours that also stay near the key colour, which the thick dark outlines
 * of the artwork stop. Growing from every strict seed
 * rather than only from the border also clears enclosed pockets such as the gap
 * between a character's legs. Surviving pixels that touch the removed region
 * are feathered and un-mixed, so no coloured fringe is left on the outline.
 */
export function keyBackdrop(
  bitmap: Bitmap,
  key: Colour,
  tolerance = 62,
  feather = 74,
  strict = 34,
): Bitmap {
  const count = bitmap.width * bitmap.height;
  const removed = new Uint8Array(count);
  const queue: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (distanceTo(bitmap, index, key) > strict) continue;
    removed[index] = 1;
    queue.push(index);
  }
  const grow = (index: number): void => {
    if (removed[index] || distanceTo(bitmap, index, key) > tolerance) return;
    removed[index] = 1;
    queue.push(index);
  };
  while (queue.length > 0) {
    const index = queue.pop()!;
    const x = index % bitmap.width;
    const y = (index - x) / bitmap.width;
    if (x > 0) grow(index - 1);
    if (x < bitmap.width - 1) grow(index + 1);
    if (y > 0) grow(index - bitmap.width);
    if (y < bitmap.height - 1) grow(index + bitmap.width);
  }

  const result = createBitmap(bitmap.width, bitmap.height);
  for (let index = 0; index < count; index += 1) {
    if (removed[index]) continue;
    const offset = index * 4;
    const x = index % bitmap.width;
    const y = (index - x) / bitmap.width;
    const touchesBackdrop =
      (x > 0 && removed[index - 1] === 1) ||
      (x < bitmap.width - 1 && removed[index + 1] === 1) ||
      (y > 0 && removed[index - bitmap.width] === 1) ||
      (y < bitmap.height - 1 && removed[index + bitmap.width] === 1);
    const distance = distanceTo(bitmap, index, key);
    const alpha =
      touchesBackdrop && distance < feather
        ? Math.max(0, Math.min(1, distance / feather))
        : 1;
    const unmix = (value: number, keyValue: number): number =>
      Math.max(
        0,
        Math.min(255, Math.round((value - (1 - alpha) * keyValue) / alpha)),
      );
    result.data[offset] =
      alpha === 1 ? bitmap.data[offset]! : unmix(bitmap.data[offset]!, key.r);
    result.data[offset + 1] =
      alpha === 1
        ? bitmap.data[offset + 1]!
        : unmix(bitmap.data[offset + 1]!, key.g);
    result.data[offset + 2] =
      alpha === 1
        ? bitmap.data[offset + 2]!
        : unmix(bitmap.data[offset + 2]!, key.b);
    result.data[offset + 3] = Math.round(alpha * 255);
  }
  return result;
}

/** Drops fully surrounded transparent margins so a sprite anchors predictably. */
export function trim(bitmap: Bitmap, threshold = 8): Bitmap {
  let minimumX = bitmap.width;
  let minimumY = bitmap.height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (bitmap.data[(y * bitmap.width + x) * 4 + 3]! < threshold) continue;
      if (x < minimumX) minimumX = x;
      if (x > maximumX) maximumX = x;
      if (y < minimumY) minimumY = y;
      if (y > maximumY) maximumY = y;
    }
  }
  if (maximumX < 0) return createBitmap(1, 1);
  return crop(
    bitmap,
    minimumX,
    minimumY,
    maximumX - minimumX + 1,
    maximumY - minimumY + 1,
  );
}

/**
 * Box-filter resize over premultiplied alpha, so shrinking a keyed sprite does
 * not pull transparent black into its outline.
 */
export function resize(bitmap: Bitmap, width: number, height: number): Bitmap {
  const result = createBitmap(width, height);
  const scaleX = bitmap.width / width;
  const scaleY = bitmap.height / height;
  for (let y = 0; y < height; y += 1) {
    const startY = Math.floor(y * scaleY);
    const endY = Math.max(startY + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < width; x += 1) {
      const startX = Math.floor(x * scaleX);
      const endX = Math.max(startX + 1, Math.floor((x + 1) * scaleX));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let samples = 0;
      for (let sourceY = startY; sourceY < endY; sourceY += 1) {
        for (let sourceX = startX; sourceX < endX; sourceX += 1) {
          const offset = (sourceY * bitmap.width + sourceX) * 4;
          const weight = bitmap.data[offset + 3]! / 255;
          red += bitmap.data[offset]! * weight;
          green += bitmap.data[offset + 1]! * weight;
          blue += bitmap.data[offset + 2]! * weight;
          alpha += bitmap.data[offset + 3]!;
          samples += 1;
        }
      }
      const target = (y * width + x) * 4;
      const averageAlpha = alpha / samples;
      const weightSum = alpha / 255 || 1;
      result.data[target] = Math.round(red / weightSum);
      result.data[target + 1] = Math.round(green / weightSum);
      result.data[target + 2] = Math.round(blue / weightSum);
      result.data[target + 3] = Math.round(averageAlpha);
    }
  }
  return result;
}

/** Scales a bitmap so its longest side matches `size`, keeping aspect ratio. */
export function fitWithin(bitmap: Bitmap, size: number): Bitmap {
  const scale = size / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) return bitmap;
  return resize(
    bitmap,
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
}

/** Average colour of the four corner pixels, used to detect a flat backdrop. */
export function cornerColour(bitmap: Bitmap): Colour {
  const corners = [
    pixel(bitmap, 0, 0),
    pixel(bitmap, bitmap.width - 1, 0),
    pixel(bitmap, 0, bitmap.height - 1),
    pixel(bitmap, bitmap.width - 1, bitmap.height - 1),
  ];
  return {
    r: Math.round(corners.reduce((total, value) => total + value[0]!, 0) / 4),
    g: Math.round(corners.reduce((total, value) => total + value[1]!, 0) / 4),
    b: Math.round(corners.reduce((total, value) => total + value[2]!, 0) / 4),
  };
}
