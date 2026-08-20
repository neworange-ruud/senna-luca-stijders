import type { ArenaDefinition } from "../types.js";

/**
 * Two ground plates with a gap between them. The crater in the middle is a safe
 * island, so the gap is crossed in two hops and a miss costs a respawn instead
 * of the match.
 */
export const SPACE_ARENA: ArenaDefinition = {
  id: "space",
  label: "Ruimteplaneet",
  bounds: { x: 0, y: 0, width: 3_200, height: 1_400 },
  fallBoundaryY: 1_520,
  surfaces: [
    {
      id: "plate-west",
      kind: "floor",
      x: 0,
      y: 1_200,
      width: 1_100,
      height: 200,
    },
    {
      id: "plate-east",
      kind: "floor",
      x: 2_100,
      y: 1_200,
      width: 1_100,
      height: 200,
    },
    {
      id: "crater",
      kind: "platform",
      x: 1_350,
      y: 1_260,
      width: 500,
      height: 140,
    },
    {
      id: "rock-west",
      kind: "platform",
      x: 700,
      y: 1_060,
      width: 300,
      height: 26,
    },
    {
      id: "rock-middle",
      kind: "platform",
      x: 1_250,
      y: 980,
      width: 340,
      height: 26,
    },
    {
      id: "rock-high",
      kind: "platform",
      x: 1_700,
      y: 860,
      width: 300,
      height: 26,
    },
    {
      id: "rock-east",
      kind: "platform",
      x: 2_200,
      y: 1_060,
      width: 300,
      height: 26,
    },
    { id: "pillar", kind: "cover", x: 560, y: 1_100, width: 100, height: 100 },
    { id: "dome", kind: "cover", x: 2_600, y: 1_100, width: 180, height: 100 },
  ],
  spawns: {
    luca: [
      { id: "luca-space-west", surfaceId: "plate-west", x: 200, y: 1_200 },
      { id: "luca-space-east", surfaceId: "plate-east", x: 2_400, y: 1_200 },
    ],
    senna: [
      { id: "senna-space-east", surfaceId: "plate-east", x: 3_000, y: 1_200 },
      { id: "senna-space-west", surfaceId: "plate-west", x: 800, y: 1_200 },
    ],
  },
  chestPoints: [
    { id: "chest-space-west", surfaceId: "plate-west", x: 500, y: 1_200 },
    { id: "chest-space-east", surfaceId: "plate-east", x: 2_900, y: 1_200 },
    { id: "chest-space-high", surfaceId: "rock-high", x: 1_850, y: 860 },
    { id: "chest-space-crater", surfaceId: "crater", x: 1_600, y: 1_260 },
  ],
  teleports: [],
};
