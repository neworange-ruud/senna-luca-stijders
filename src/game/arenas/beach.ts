import type { ArenaDefinition } from "../types.js";

export const BEACH_ARENA: ArenaDefinition = {
  id: "beach",
  label: "Strand",
  bounds: { x: 0, y: 0, width: 3_200, height: 1_400 },
  fallBoundaryY: 1_520,
  surfaces: [
    { id: "floor", kind: "floor", x: 0, y: 1_200, width: 3_200, height: 200 },
    {
      id: "west-low",
      kind: "platform",
      x: 500,
      y: 1_070,
      width: 600,
      height: 30,
    },
    {
      id: "west-high",
      kind: "platform",
      x: 1_000,
      y: 940,
      width: 500,
      height: 30,
    },
    {
      id: "east-low",
      kind: "platform",
      x: 2_100,
      y: 1_070,
      width: 600,
      height: 30,
    },
    {
      id: "east-high",
      kind: "platform",
      x: 1_700,
      y: 940,
      width: 500,
      height: 30,
    },
    { id: "hut", kind: "cover", x: 1_500, y: 1_000, width: 200, height: 200 },
  ],
  spawns: {
    luca: [
      { id: "luca-west", surfaceId: "floor", x: 320, y: 1_200 },
      { id: "luca-east", surfaceId: "floor", x: 2_500, y: 1_200 },
    ],
    senna: [
      { id: "senna-east", surfaceId: "floor", x: 2_880, y: 1_200 },
      { id: "senna-west", surfaceId: "floor", x: 700, y: 1_200 },
    ],
  },
  chestPoints: [
    { id: "chest-west-floor", surfaceId: "floor", x: 900, y: 1_200 },
    { id: "chest-east-floor", surfaceId: "floor", x: 2_300, y: 1_200 },
    { id: "chest-west-high", surfaceId: "west-high", x: 1_250, y: 940 },
    { id: "chest-east-high", surfaceId: "east-high", x: 1_950, y: 940 },
  ],
  teleports: [],
};
