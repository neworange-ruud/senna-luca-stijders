import type { ArenaDefinition } from "../types.js";

/**
 * The smallest world. Everything is within a few steps of everything else, so
 * this is the one to pick for a short, loud fight.
 */
export const BOAT_ARENA: ArenaDefinition = {
  id: "boat",
  label: "Boot",
  bounds: { x: 0, y: 0, width: 2_400, height: 1_200 },
  fallBoundaryY: 1_320,
  surfaces: [
    { id: "deck", kind: "floor", x: 0, y: 1_000, width: 2_400, height: 200 },
    {
      id: "crate-west",
      kind: "platform",
      x: 560,
      y: 880,
      width: 240,
      height: 26,
    },
    {
      id: "crate-east",
      kind: "platform",
      x: 1_600,
      y: 880,
      width: 240,
      height: 26,
    },
    {
      id: "cabin-roof",
      kind: "platform",
      x: 1_000,
      y: 830,
      width: 400,
      height: 30,
    },
    {
      id: "mast-platform",
      kind: "platform",
      x: 1_120,
      y: 700,
      width: 200,
      height: 24,
    },
    {
      id: "rail-east",
      kind: "platform",
      x: 2_000,
      y: 880,
      width: 300,
      height: 26,
    },
    { id: "cabin", kind: "cover", x: 1_000, y: 860, width: 400, height: 140 },
    { id: "barrel", kind: "cover", x: 300, y: 920, width: 100, height: 80 },
  ],
  spawns: {
    luca: [
      { id: "luca-boat-west", surfaceId: "deck", x: 160, y: 1_000 },
      { id: "luca-boat-east", surfaceId: "deck", x: 1_800, y: 1_000 },
    ],
    senna: [
      { id: "senna-boat-east", surfaceId: "deck", x: 2_240, y: 1_000 },
      { id: "senna-boat-west", surfaceId: "deck", x: 600, y: 1_000 },
    ],
  },
  chestPoints: [
    { id: "chest-boat-deck-west", surfaceId: "deck", x: 470, y: 1_000 },
    { id: "chest-boat-deck-east", surfaceId: "deck", x: 2_200, y: 1_000 },
    { id: "chest-boat-mast", surfaceId: "mast-platform", x: 1_220, y: 700 },
    { id: "chest-boat-crate", surfaceId: "crate-east", x: 1_720, y: 880 },
  ],
  teleports: [],
};
