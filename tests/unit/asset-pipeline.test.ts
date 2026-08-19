import { describe, expect, it } from "vitest";
import {
  ICON_SHEET,
  prepareSprite,
  sliceSheet,
} from "../../scripts/asset-pipeline";
import {
  cornerColour,
  createBitmap,
  keyBackdrop,
  pixel,
  resize,
  trim,
} from "../../scripts/image-ops";
import { decodePng, encodePng, type Bitmap } from "../../scripts/png";

const MAGENTA = { r: 214, g: 41, b: 89 };
const CORAL = { r: 249, g: 103, b: 117 };

/**
 * A backdrop-coloured canvas with an outlined block of artwork. The artwork
 * deliberately contains a coral fill that is close to the backdrop colour, and
 * an enclosed hole of pure backdrop colour, because both broke earlier keying
 * attempts.
 */
function generatedArtwork(): Bitmap {
  const bitmap = createBitmap(24, 24);
  const set = (x: number, y: number, r: number, g: number, b: number): void => {
    const offset = (y * 24 + x) * 4;
    bitmap.data[offset] = r;
    bitmap.data[offset + 1] = g;
    bitmap.data[offset + 2] = b;
    bitmap.data[offset + 3] = 255;
  };
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 24; x += 1) set(x, y, MAGENTA.r, MAGENTA.g, MAGENTA.b);
  }
  for (let y = 6; y < 18; y += 1) {
    for (let x = 6; x < 18; x += 1) {
      const outline = x === 6 || x === 17 || y === 6 || y === 17;
      if (outline) set(x, y, 20, 20, 30);
      else set(x, y, CORAL.r, CORAL.g, CORAL.b);
    }
  }
  // An enclosed pocket of backdrop, like the gap between a character's legs.
  set(11, 11, MAGENTA.r, MAGENTA.g, MAGENTA.b);
  set(12, 11, MAGENTA.r, MAGENTA.g, MAGENTA.b);
  return bitmap;
}

describe("PNG codec", () => {
  it("round-trips pixels through encode and decode", () => {
    const original = generatedArtwork();
    const decoded = decodePng(encodePng(original));
    expect(decoded.width).toBe(original.width);
    expect(decoded.height).toBe(original.height);
    expect([...decoded.data]).toEqual([...original.data]);
  });
});

describe("backdrop keying", () => {
  it("removes the backdrop and enclosed pockets without eating similar artwork", () => {
    const keyed = keyBackdrop(generatedArtwork(), MAGENTA);
    expect(pixel(keyed, 0, 0)[3]).toBe(0);
    expect(pixel(keyed, 11, 11)[3]).toBe(0);
    expect(pixel(keyed, 12, 12)[3]).toBe(255);
    expect(pixel(keyed, 12, 12).slice(0, 3)).toEqual([
      CORAL.r,
      CORAL.g,
      CORAL.b,
    ]);
  });

  it("detects the backdrop colour from the corners", () => {
    expect(cornerColour(generatedArtwork())).toEqual(MAGENTA);
  });

  it("trims a sprite down to its artwork", () => {
    const trimmed = trim(keyBackdrop(generatedArtwork(), MAGENTA));
    expect({ width: trimmed.width, height: trimmed.height }).toEqual({
      width: 12,
      height: 12,
    });
  });

  it("keeps the aspect ratio while scaling a prepared sprite down", () => {
    const prepared = prepareSprite(generatedArtwork(), 6);
    expect({ width: prepared.width, height: prepared.height }).toEqual({
      width: 6,
      height: 6,
    });
  });
});

describe("resize", () => {
  it("averages source pixels instead of dropping them", () => {
    const source = createBitmap(2, 1);
    source.data.set([0, 0, 0, 255, 100, 200, 40, 255]);
    const scaled = resize(source, 1, 1);
    expect(pixel(scaled, 0, 0)).toEqual([50, 100, 20, 255]);
  });

  it("ignores transparent pixels when averaging colour", () => {
    const source = createBitmap(2, 1);
    source.data.set([255, 0, 0, 0, 10, 20, 30, 255]);
    const scaled = resize(source, 1, 1);
    expect(pixel(scaled, 0, 0)).toEqual([10, 20, 30, 128]);
  });
});

describe("icon sheet", () => {
  it("names every cell of the generated 4x4 sheet at most once", () => {
    expect(ICON_SHEET).toHaveLength(16);
    const shipped = ICON_SHEET.filter((name) => name !== null);
    expect(new Set(shipped).size).toBe(shipped.length);
  });

  it("slices a sheet row by row", () => {
    const sheet = createBitmap(4, 4);
    sheet.data[(1 * 4 + 3) * 4] = 200;
    const cells = sliceSheet(sheet, 2, 2);
    expect(cells).toHaveLength(4);
    expect(cells[1]!.width).toBe(2);
    expect(pixel(cells[1]!, 1, 1)[0]).toBe(200);
  });
});
