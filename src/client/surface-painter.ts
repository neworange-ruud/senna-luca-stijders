import type { ArenaSurface } from "../game/types.js";
import { speckAt, type SurfaceStyle } from "./surface-style.js";

export { surfaceStyle } from "./surface-style.js";

const PLANK_SPACING = 26;
const PLANK_END_SPACING = 54;
const BOARD_SPACING = 22;
const BRICK_HEIGHT = 20;
const BRICK_WIDTH = 46;
const RIVET_SPACING = 34;

/** The outline path of a surface, used for both filling and clipping. */
function outlinePath(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(0, 0, width, height, Math.min(radius, height / 2));
}

function paintPattern(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  style: SurfaceStyle,
): void {
  context.strokeStyle = style.detail;
  context.fillStyle = style.detail;
  context.lineWidth = 2;
  switch (style.pattern) {
    case "planks":
      // A deck is deep enough to show the seams between its boards. A branch or
      // a jetty is only a few units thick, so there the seams run the other way,
      // across it, as the ends of the boards it is made of.
      if (height >= PLANK_SPACING * 2) {
        for (
          let y = style.capHeight + PLANK_SPACING;
          y < height;
          y += PLANK_SPACING
        ) {
          context.beginPath();
          context.moveTo(2, y);
          context.lineTo(width - 2, y);
          context.stroke();
        }
        break;
      }
      for (let x = PLANK_END_SPACING; x < width - 4; x += PLANK_END_SPACING) {
        context.beginPath();
        context.moveTo(x, style.capHeight);
        context.lineTo(x, height - 2);
        context.stroke();
      }
      break;
    case "boards":
      // Seams across it, like the planks of a hut or the ribs of a container.
      for (let x = BOARD_SPACING; x < width; x += BOARD_SPACING) {
        context.beginPath();
        context.moveTo(x, style.capHeight);
        context.lineTo(x, height - 2);
        context.stroke();
      }
      break;
    case "bricks":
      for (let row = 0; ; row += 1) {
        const y = style.capHeight + BRICK_HEIGHT * (row + 1);
        if (y >= height) break;
        context.beginPath();
        context.moveTo(2, y);
        context.lineTo(width - 2, y);
        context.stroke();
        const offset = row % 2 === 0 ? BRICK_WIDTH / 2 : 0;
        for (let x = offset; x < width; x += BRICK_WIDTH) {
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x, Math.min(height - 2, y + BRICK_HEIGHT));
          context.stroke();
        }
      }
      break;
    case "rivets": {
      // Bolts along a steel beam, one row when it is thin, two when it is not.
      const rows =
        height > 40 ? [style.capHeight + 10, height - 10] : [height / 2 + 1];
      for (const y of rows) {
        for (let x = RIVET_SPACING / 2; x < width; x += RIVET_SPACING) {
          context.beginPath();
          context.arc(x, y, 2.6, 0, Math.PI * 2);
          context.fill();
        }
      }
      break;
    }
    case "speckle": {
      // Grains of sand, gravel or rock, in the same place every frame.
      const step = 9;
      for (let y = style.capHeight + 4; y < height - 2; y += step) {
        for (let x = 4; x < width - 2; x += step) {
          const noise = speckAt(x, y);
          if (noise < 0.72) continue;
          context.globalAlpha = 0.35 + noise * 0.35;
          context.beginPath();
          context.arc(x, y, noise * 2.2, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
      break;
    }
    case "none":
      break;
  }
}

/**
 * Paints one surface into a context whose origin is the surface's top left
 * corner and whose units are arena units.
 *
 * The shape stays exactly the rectangle the simulation collides with: the cap,
 * the pattern and the outline are drawn inside it, never outside, so nothing
 * here can make a platform look bigger or smaller than it is to jump on.
 */
export function paintSurface(
  context: CanvasRenderingContext2D,
  surface: Pick<ArenaSurface, "width" | "height">,
  style: SurfaceStyle,
): void {
  const { width, height } = surface;
  outlinePath(context, width, height, style.radius);
  context.save();
  context.clip();

  context.fillStyle = style.fill;
  context.fillRect(0, 0, width, height);

  // A darker underside, so the surface has a lit top and a shaded bottom
  // instead of one flat colour.
  const shade = context.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "rgba(255, 255, 255, 0)");
  shade.addColorStop(1, "rgba(16, 40, 59, 0.28)");
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);

  paintPattern(context, width, height, style);

  const capHeight = Math.min(style.capHeight, height / 2);
  context.fillStyle = style.cap;
  context.fillRect(0, 0, width, capHeight);
  // A thin bright line right on the walking edge catches the eye first, which
  // is exactly where a child needs to look to judge a jump.
  context.fillStyle = "rgba(255, 255, 255, 0.35)";
  context.fillRect(0, 0, width, Math.max(1, capHeight * 0.28));

  context.restore();

  context.strokeStyle = style.outline;
  context.lineWidth = 4;
  outlinePath(context, width, height, style.radius);
  context.stroke();
}
