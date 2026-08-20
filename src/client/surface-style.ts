import type { ArenaSurface, WorldId } from "../game/types.js";

/**
 * The marks drawn on a surface. They are decoration only: every surface is
 * still the plain rectangle the simulation collides with.
 */
export type SurfacePattern =
  "none" | "planks" | "boards" | "bricks" | "rivets" | "speckle";

export interface SurfaceStyle {
  /** The body of the surface. */
  fill: string;
  /** A strip along the top, which is the part a player actually stands on. */
  cap: string;
  /** Height of that strip in arena units. */
  capHeight: number;
  outline: string;
  pattern: SurfacePattern;
  /** Colour of the pattern marks. */
  detail: string;
  /** Corner rounding in arena units. */
  radius: number;
}

type WorldStyles = Readonly<Record<ArenaSurface["kind"], SurfaceStyle>>;

/**
 * What each world is built from. A beach has sand and jetty planks, a building
 * site has concrete and painted steel: the same three kinds of surface, made of
 * something that belongs to the world the children chose.
 */
export const SURFACE_STYLES: Readonly<Record<WorldId, WorldStyles>> = {
  beach: {
    floor: {
      fill: "#e0bd80",
      cap: "#f2dcaf",
      capHeight: 14,
      outline: "#a3803f",
      pattern: "speckle",
      detail: "#cba766",
      radius: 0,
    },
    platform: {
      fill: "#c2854a",
      cap: "#dda668",
      capHeight: 8,
      outline: "#7c4d24",
      pattern: "planks",
      detail: "#a26b36",
      radius: 8,
    },
    cover: {
      fill: "#b56a41",
      cap: "#cf8354",
      capHeight: 10,
      outline: "#6d3d1d",
      pattern: "boards",
      detail: "#8f5029",
      radius: 8,
    },
  },
  forest: {
    floor: {
      fill: "#6d4c31",
      cap: "#57a04c",
      capHeight: 18,
      outline: "#3c2a1b",
      pattern: "speckle",
      detail: "#5a3d26",
      radius: 0,
    },
    platform: {
      fill: "#6b4b2c",
      cap: "#8a6437",
      capHeight: 8,
      outline: "#3f2b18",
      pattern: "planks",
      detail: "#513720",
      radius: 12,
    },
    cover: {
      fill: "#5a4028",
      cap: "#6f5132",
      capHeight: 10,
      outline: "#33230f",
      pattern: "boards",
      detail: "#432f1c",
      radius: 10,
    },
  },
  space: {
    floor: {
      fill: "#6a6382",
      cap: "#8a83a6",
      capHeight: 14,
      outline: "#3a3450",
      pattern: "speckle",
      detail: "#544d6d",
      radius: 0,
    },
    platform: {
      fill: "#8d93a8",
      cap: "#b6bccd",
      capHeight: 7,
      outline: "#4d5266",
      pattern: "rivets",
      detail: "#5d6379",
      radius: 6,
    },
    cover: {
      fill: "#4d4766",
      cap: "#645d82",
      capHeight: 10,
      outline: "#2a2540",
      pattern: "speckle",
      detail: "#3c3752",
      radius: 14,
    },
  },
  construction: {
    floor: {
      fill: "#9a988f",
      cap: "#b7b5ab",
      capHeight: 14,
      outline: "#5d5b53",
      pattern: "speckle",
      detail: "#84827a",
      radius: 0,
    },
    platform: {
      fill: "#cf7620",
      cap: "#e79c47",
      capHeight: 7,
      outline: "#8a4a12",
      pattern: "rivets",
      detail: "#9c5715",
      radius: 4,
    },
    cover: {
      fill: "#2f7f8f",
      cap: "#48a2b1",
      capHeight: 10,
      outline: "#1c5764",
      pattern: "boards",
      detail: "#226673",
      radius: 4,
    },
  },
  city: {
    floor: {
      fill: "#575c64",
      cap: "#6e747d",
      capHeight: 12,
      outline: "#2e3137",
      pattern: "speckle",
      detail: "#4a4f56",
      radius: 0,
    },
    platform: {
      fill: "#8d8e95",
      cap: "#a9abb3",
      capHeight: 9,
      outline: "#565760",
      pattern: "bricks",
      detail: "#767780",
      radius: 4,
    },
    cover: {
      fill: "#c25546",
      cap: "#dd7461",
      capHeight: 10,
      outline: "#7d2f24",
      pattern: "boards",
      detail: "#a2412f",
      radius: 8,
    },
  },
  boat: {
    floor: {
      fill: "#b3803f",
      cap: "#cd9b5c",
      capHeight: 12,
      outline: "#75491f",
      pattern: "planks",
      detail: "#95662f",
      radius: 0,
    },
    platform: {
      fill: "#a97243",
      cap: "#c58c56",
      capHeight: 8,
      outline: "#6f4520",
      pattern: "planks",
      detail: "#8a5b30",
      radius: 6,
    },
    cover: {
      fill: "#c9ad7c",
      cap: "#dfc79a",
      capHeight: 10,
      outline: "#84683c",
      pattern: "boards",
      detail: "#a98d5d",
      radius: 6,
    },
  },
};

/**
 * The style for a surface. A world this build does not know falls back to the
 * beach, the same way the arena itself does, so an unexpected world is still
 * drawn as something rather than nothing.
 */
export function surfaceStyle(
  world: string | null | undefined,
  kind: ArenaSurface["kind"],
): SurfaceStyle {
  const styles = SURFACE_STYLES[world as WorldId] ?? SURFACE_STYLES.beach;
  return styles[kind];
}

/**
 * A repeatable speck pattern. Randomness would shimmer from frame to frame and
 * differ between the two iPads, so the grain is a function of the position.
 */
export function speckAt(x: number, y: number): number {
  const hashed = Math.sin(x * 127.1 + y * 311.7) * 43_758.545;
  return hashed - Math.floor(hashed);
}
