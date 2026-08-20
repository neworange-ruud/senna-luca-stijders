import { describe, expect, it } from "vitest";
import { ImageLibrary, spriteRectangle } from "../../src/client/assets";

interface FakeImage {
  src: string;
  decoding: string;
  listeners: (() => void)[];
  addEventListener: (name: string, listener: () => void) => void;
}

function fakeLoader(): {
  load: (url: string) => HTMLImageElement;
  images: Map<string, FakeImage>;
} {
  const images = new Map<string, FakeImage>();
  return {
    images,
    load: (url: string) => {
      const image: FakeImage = {
        src: url,
        decoding: "async",
        listeners: [],
        addEventListener: (_name, listener) => image.listeners.push(listener),
      };
      images.set(url, image);
      return image as unknown as HTMLImageElement;
    },
  };
}

describe("image library", () => {
  it("resolves each asset name to its prepared file", () => {
    const loader = fakeLoader();
    const library = new ImageLibrary(loader.load);
    library.request("sprite:knight", "world:beach", "icon:sword");
    expect([...loader.images.keys()]).toEqual([
      "/art/sprites/knight.png",
      "/art/worlds/beach.png",
      "/art/icons/sword.png",
    ]);
  });

  it("returns nothing until an image has loaded", () => {
    const loader = fakeLoader();
    const library = new ImageLibrary(loader.load);
    expect(library.get("sprite:pirate")).toBeNull();
    expect(library.loadedCount).toBe(0);
    for (const listener of loader.images.get("/art/sprites/pirate.png")!
      .listeners) {
      listener();
    }
    expect(library.get("sprite:pirate")).not.toBeNull();
    expect(library.loadedCount).toBe(1);
  });

  it("requests each file only once", () => {
    const loader = fakeLoader();
    const library = new ImageLibrary(loader.load);
    library.request("icon:nerf");
    library.request("icon:nerf");
    library.get("icon:nerf");
    expect(loader.images.size).toBe(1);
  });
});

describe("sprite placement", () => {
  const box = { x: 100, y: 200, width: 64, height: 96 };

  it("keeps the drawing centred on the collision box and standing on its floor", () => {
    const placed = spriteRectangle(box, { width: 145, height: 384 }, 1);
    expect(placed.height).toBe(96);
    expect(placed.y + placed.height).toBe(box.y + box.height);
    expect(placed.x + placed.width / 2).toBe(box.x + box.width / 2);
  });

  it("scales from the box height so artwork cannot change the hitbox", () => {
    const small = spriteRectangle(box, { width: 100, height: 100 }, 1);
    const tall = spriteRectangle(box, { width: 50, height: 100 }, 1);
    expect(small.width).toBe(96);
    expect(tall.width).toBe(48);
    expect(small.height).toBe(tall.height);
  });

  it("survives an image with no dimensions yet", () => {
    expect(spriteRectangle(box, { width: 0, height: 0 }).width).toBe(0);
  });
});
