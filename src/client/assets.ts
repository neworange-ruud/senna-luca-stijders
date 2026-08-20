import type { CosmeticId, ItemId, WorldId } from "../game/types.js";

/**
 * Names of the prepared artwork under `public/art`. The files are produced
 * from the Layer MCP generations by `npm run assets`; the game never depends on
 * them being present, so a slow or failed load only falls back to the geometric
 * drawing.
 */
export type AssetName =
  | `sprite:${CosmeticId}`
  | `world:${WorldId}`
  | `icon:${ItemId}`
  | `icon:cosmetic-${CosmeticId}`
  | "icon:heart"
  | "icon:heart-lost"
  | "icon:chest"
  | "icon:dart"
  | "icon:armor"
  | "icon:speed"
  | "icon:camouflage"
  | "icon:impact";

function assetUrl(name: AssetName): string {
  const [group, file] = name.split(":") as [string, string];
  const folder =
    group === "sprite" ? "sprites" : group === "world" ? "worlds" : "icons";
  return `/art/${folder}/${file}.png`;
}

/**
 * Loads artwork once and hands the renderer whatever is ready this frame.
 * Rendering never waits on a load, so gameplay starts at the same moment with
 * or without artwork.
 */
export class ImageLibrary {
  private readonly images = new Map<AssetName, HTMLImageElement>();
  private readonly ready = new Set<AssetName>();

  constructor(private readonly load = defaultLoader) {}

  request(...names: readonly AssetName[]): void {
    for (const name of names) {
      if (this.images.has(name)) continue;
      const image = this.load(assetUrl(name));
      this.images.set(name, image);
      image.addEventListener("load", () => this.ready.add(name), {
        once: true,
      });
    }
  }

  /** The loaded image, or null while it is still loading or has failed. */
  get(name: AssetName): HTMLImageElement | null {
    this.request(name);
    return this.ready.has(name) ? (this.images.get(name) ?? null) : null;
  }

  get loadedCount(): number {
    return this.ready.size;
  }
}

function defaultLoader(url: string): HTMLImageElement {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  return image;
}

/**
 * Fits a sprite inside a player's collision box. The box is the gameplay
 * contract, so the drawing is scaled from its height and centred on it; the
 * artwork never changes where a hit lands.
 */
export function spriteRectangle(
  box: { x: number; y: number; width: number; height: number },
  image: { width: number; height: number },
  heightFactor = 1.16,
): { x: number; y: number; width: number; height: number } {
  const height = box.height * heightFactor;
  const width = image.height > 0 ? (image.width / image.height) * height : 0;
  return {
    x: box.x + box.width / 2 - width / 2,
    y: box.y + box.height - height,
    width,
    height,
  };
}
