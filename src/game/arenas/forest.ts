import type { ArenaDefinition } from "../types.js";

/**
 * Two tree staircases with a wide canopy in the middle. Climbing is safe and
 * the trunks give a child something to hide behind, so this world is about
 * cover rather than about falling.
 */
export const FOREST_ARENA: ArenaDefinition = {
  id: "forest",
  label: "Bos",
  bounds: { x: 0, y: 0, width: 3_200, height: 1_400 },
  fallBoundaryY: 1_520,
  surfaces: [
    { id: "floor", kind: "floor", x: 0, y: 1_200, width: 3_200, height: 200 },
    {
      id: "branch-west-low",
      kind: "platform",
      x: 300,
      y: 1_075,
      width: 380,
      height: 28,
    },
    {
      id: "branch-west-high",
      kind: "platform",
      x: 760,
      y: 950,
      width: 340,
      height: 28,
    },
    {
      id: "canopy",
      kind: "platform",
      x: 1_250,
      y: 830,
      width: 700,
      height: 30,
    },
    {
      id: "branch-east-high",
      kind: "platform",
      x: 2_100,
      y: 950,
      width: 340,
      height: 28,
    },
    {
      id: "branch-east-low",
      kind: "platform",
      x: 2_520,
      y: 1_075,
      width: 380,
      height: 28,
    },
    {
      id: "trunk-west",
      kind: "cover",
      x: 420,
      y: 1_100,
      width: 120,
      height: 100,
    },
    {
      id: "trunk-middle",
      kind: "cover",
      x: 1_560,
      y: 1_000,
      width: 80,
      height: 200,
    },
    {
      id: "trunk-east",
      kind: "cover",
      x: 2_660,
      y: 1_100,
      width: 120,
      height: 100,
    },
  ],
  spawns: {
    luca: [
      { id: "luca-forest-west", surfaceId: "floor", x: 260, y: 1_200 },
      { id: "luca-forest-east", surfaceId: "floor", x: 2_400, y: 1_200 },
    ],
    senna: [
      { id: "senna-forest-east", surfaceId: "floor", x: 2_940, y: 1_200 },
      { id: "senna-forest-west", surfaceId: "floor", x: 800, y: 1_200 },
    ],
  },
  chestPoints: [
    { id: "chest-forest-floor-west", surfaceId: "floor", x: 800, y: 1_200 },
    { id: "chest-forest-floor-east", surfaceId: "floor", x: 2_400, y: 1_200 },
    { id: "chest-forest-canopy", surfaceId: "canopy", x: 1_600, y: 830 },
    {
      id: "chest-forest-branch",
      surfaceId: "branch-west-high",
      x: 930,
      y: 950,
    },
  ],
  teleports: [],
};
