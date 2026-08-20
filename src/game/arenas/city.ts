import type { ArenaDefinition } from "../types.js";

/**
 * A street with two rooftops that no jump can reach. The lifts are the only way
 * up, which is what makes the teleports worth using and easy to explain: a lift
 * always goes to the one rooftop above it, and back down again.
 */
export const CITY_ARENA: ArenaDefinition = {
  id: "city",
  label: "Stad",
  bounds: { x: 0, y: 0, width: 3_200, height: 1_400 },
  fallBoundaryY: 1_520,
  surfaces: [
    { id: "street", kind: "floor", x: 0, y: 1_200, width: 3_200, height: 200 },
    {
      id: "awning-west",
      kind: "platform",
      x: 420,
      y: 1_060,
      width: 300,
      height: 26,
    },
    {
      id: "awning-east",
      kind: "platform",
      x: 2_500,
      y: 1_060,
      width: 300,
      height: 26,
    },
    {
      id: "roof-west",
      kind: "platform",
      x: 160,
      y: 880,
      width: 640,
      height: 40,
    },
    {
      id: "roof-middle",
      kind: "platform",
      x: 1_250,
      y: 800,
      width: 700,
      height: 40,
    },
    {
      id: "roof-east",
      kind: "platform",
      x: 2_400,
      y: 880,
      width: 640,
      height: 40,
    },
    { id: "bus", kind: "cover", x: 1_000, y: 1_080, width: 260, height: 120 },
    {
      id: "roof-box",
      kind: "cover",
      x: 1_500,
      y: 700,
      width: 160,
      height: 100,
    },
  ],
  spawns: {
    luca: [
      { id: "luca-city-west", surfaceId: "street", x: 180, y: 1_200 },
      { id: "luca-city-east", surfaceId: "street", x: 2_400, y: 1_200 },
    ],
    senna: [
      { id: "senna-city-east", surfaceId: "street", x: 3_020, y: 1_200 },
      { id: "senna-city-west", surfaceId: "street", x: 800, y: 1_200 },
    ],
  },
  chestPoints: [
    { id: "chest-city-street", surfaceId: "street", x: 1_600, y: 1_200 },
    {
      id: "chest-city-roof-middle",
      surfaceId: "roof-middle",
      x: 1_400,
      y: 800,
    },
    { id: "chest-city-roof-west", surfaceId: "roof-west", x: 600, y: 880 },
    { id: "chest-city-roof-east", surfaceId: "roof-east", x: 2_600, y: 880 },
  ],
  teleports: [
    {
      id: "lift-street-west",
      surfaceId: "street",
      x: 300,
      y: 1_200,
      label: "Lift west",
      destinations: ["lift-roof-west"],
    },
    {
      id: "lift-roof-west",
      surfaceId: "roof-west",
      x: 300,
      y: 880,
      label: "Lift west",
      destinations: ["lift-street-west"],
    },
    {
      id: "lift-street-east",
      surfaceId: "street",
      x: 2_900,
      y: 1_200,
      label: "Lift oost",
      destinations: ["lift-roof-east"],
    },
    {
      id: "lift-roof-east",
      surfaceId: "roof-east",
      x: 2_900,
      y: 880,
      label: "Lift oost",
      destinations: ["lift-street-east"],
    },
  ],
};
