import { describe, expect, it } from "vitest";
import { validateArena } from "../../src/game/arena";
import { COSMETICS, validateContent, WORLDS } from "../../src/game/content";

describe("lobby content", () => {
  it("defines all required neutral cosmetics without gameplay fields", () => {
    expect(COSMETICS.map((item) => item.id)).toEqual([
      "superhero",
      "soldier",
      "knight",
      "astronaut",
      "pirate",
    ]);
    expect(validateContent()).toEqual([]);
  });

  it("defines six Dutch worlds using valid shared geometry", () => {
    expect(WORLDS.map((world) => world.label)).toEqual([
      "Strand",
      "Bos",
      "Ruimteplaneet",
      "Bouwplaats",
      "Stad",
      "Boot",
    ]);
    for (const world of WORLDS) expect(validateArena(world)).toEqual([]);
  });
});
