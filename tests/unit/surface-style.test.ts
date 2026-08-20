import { describe, expect, it } from "vitest";

import {
  speckAt,
  SURFACE_STYLES,
  surfaceStyle,
} from "../../src/client/surface-style";
import { WORLDS } from "../../src/game/content";
import type { ArenaSurface, WorldId } from "../../src/game/types";

const KINDS: readonly ArenaSurface["kind"][] = ["floor", "platform", "cover"];
const WORLD_IDS = WORLDS.map((world) => world.id as WorldId);

/** Perceived brightness, for checking that a top edge is the lit one. */
function brightness(colour: string): number {
  const hex = colour.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

describe("surface styles", () => {
  it("gives every world a style for every kind of surface", () => {
    for (const world of WORLD_IDS) {
      for (const kind of KINDS) {
        const style = surfaceStyle(world, kind);
        expect({
          world,
          kind,
          valid: /^#[0-9a-f]{6}$/.test(style.fill),
        }).toEqual({ world, kind, valid: true });
      }
    }
    expect(Object.keys(SURFACE_STYLES).sort()).toEqual([...WORLD_IDS].sort());
  });

  it("builds each world out of something of its own", () => {
    for (const kind of KINDS) {
      const fills = WORLD_IDS.map((world) => surfaceStyle(world, kind).fill);
      // A sand floor and a city street must not be the same grey slab.
      expect(new Set(fills).size).toBe(WORLD_IDS.length);
    }
  });

  it("lights the top edge and shades the outline", () => {
    for (const world of WORLD_IDS) {
      for (const kind of KINDS) {
        const style = surfaceStyle(world, kind);
        expect(
          {
            world,
            kind,
            capLighter: brightness(style.cap) > brightness(style.fill),
            outlineDarker: brightness(style.outline) < brightness(style.fill),
          },
          `${world} ${kind}`,
        ).toEqual({ world, kind, capLighter: true, outlineDarker: true });
      }
    }
  });

  it("keeps the detail marks visible but quiet", () => {
    for (const world of WORLD_IDS) {
      for (const kind of KINDS) {
        const style = surfaceStyle(world, kind);
        const difference = Math.abs(
          brightness(style.detail) - brightness(style.fill),
        );
        expect({ world, kind, tooLoud: difference > 70 }).toEqual({
          world,
          kind,
          tooLoud: false,
        });
        expect({ world, kind, invisible: difference < 6 }).toEqual({
          world,
          kind,
          invisible: false,
        });
      }
    }
  });

  it("keeps the walking edge inside a thin platform", () => {
    for (const world of WORLD_IDS) {
      // The thinnest platforms in the six worlds are 24 units high.
      expect(surfaceStyle(world, "platform").capHeight).toBeLessThanOrEqual(12);
    }
  });

  it("falls back to the beach for a world it does not know", () => {
    expect(surfaceStyle("atlantis", "floor")).toEqual(
      surfaceStyle("beach", "floor"),
    );
    expect(surfaceStyle(null, "platform")).toEqual(
      surfaceStyle("beach", "platform"),
    );
  });

  it("puts the same speck in the same place every time", () => {
    expect(speckAt(12, 34)).toBe(speckAt(12, 34));
    expect(speckAt(12, 34)).not.toBe(speckAt(13, 34));
    for (const [x, y] of [
      [0, 0],
      [7, 130],
      [3_199, 1_399],
    ] as const) {
      const value = speckAt(x, y);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
