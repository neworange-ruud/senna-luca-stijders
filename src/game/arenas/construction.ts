import type { ArenaDefinition } from "../types.js";

/**
 * A scaffolding tower on one side and long girders across the middle. The
 * height difference is the point: the tower is easy to climb and hard to hold.
 */
export const CONSTRUCTION_ARENA: ArenaDefinition = {
  id: "construction",
  label: "Bouwplaats",
  bounds: { x: 0, y: 0, width: 3_200, height: 1_400 },
  fallBoundaryY: 1_520,
  surfaces: [
    { id: "floor", kind: "floor", x: 0, y: 1_200, width: 3_200, height: 200 },
    {
      id: "scaffold-low",
      kind: "platform",
      x: 260,
      y: 1_070,
      width: 420,
      height: 26,
    },
    {
      id: "scaffold-middle",
      kind: "platform",
      x: 260,
      y: 940,
      width: 420,
      height: 26,
    },
    {
      id: "scaffold-high",
      kind: "platform",
      x: 260,
      y: 810,
      width: 420,
      height: 26,
    },
    { id: "girder", kind: "platform", x: 880, y: 880, width: 900, height: 26 },
    {
      id: "girder-high",
      kind: "platform",
      x: 1_400,
      y: 750,
      width: 500,
      height: 26,
    },
    {
      id: "crane-arm",
      kind: "platform",
      x: 2_100,
      y: 940,
      width: 500,
      height: 26,
    },
    {
      id: "pipe-stack",
      kind: "platform",
      x: 2_700,
      y: 1_070,
      width: 400,
      height: 26,
    },
    {
      id: "container-west",
      kind: "cover",
      x: 760,
      y: 1_080,
      width: 220,
      height: 120,
    },
    {
      id: "container-east",
      kind: "cover",
      x: 1_900,
      y: 1_080,
      width: 220,
      height: 120,
    },
  ],
  spawns: {
    luca: [
      { id: "luca-site-west", surfaceId: "floor", x: 200, y: 1_200 },
      { id: "luca-site-east", surfaceId: "floor", x: 2_400, y: 1_200 },
    ],
    senna: [
      { id: "senna-site-east", surfaceId: "floor", x: 3_000, y: 1_200 },
      { id: "senna-site-west", surfaceId: "floor", x: 1_320, y: 1_200 },
    ],
  },
  chestPoints: [
    { id: "chest-site-floor", surfaceId: "floor", x: 1_500, y: 1_200 },
    { id: "chest-site-girder", surfaceId: "girder-high", x: 1_650, y: 750 },
    { id: "chest-site-crane", surfaceId: "crane-arm", x: 2_350, y: 940 },
    { id: "chest-site-scaffold", surfaceId: "scaffold-middle", x: 470, y: 940 },
  ],
  teleports: [],
};
