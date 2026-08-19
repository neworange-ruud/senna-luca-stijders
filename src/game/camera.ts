import type { Rectangle, Vector } from "./types.js";

export interface Camera extends Vector {
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function cameraTarget(
  focus: Rectangle,
  viewport: { width: number; height: number },
  bounds: Rectangle,
): Camera {
  const width = Math.min(viewport.width, bounds.width);
  const height = Math.min(viewport.height, bounds.height);
  return {
    x: clamp(
      focus.x + focus.width / 2 - width / 2,
      bounds.x,
      bounds.x + bounds.width - width,
    ),
    y: clamp(
      focus.y + focus.height / 2 - height / 2,
      bounds.y,
      bounds.y + bounds.height - height,
    ),
    width,
    height,
  };
}

export function followCamera(
  current: Camera,
  target: Camera,
  smoothing = 0.18,
): Camera {
  if (smoothing < 0 || smoothing > 1)
    throw new RangeError("Invalid camera smoothing.");
  return {
    x: current.x + (target.x - current.x) * smoothing,
    y: current.y + (target.y - current.y) * smoothing,
    width: target.width,
    height: target.height,
  };
}
