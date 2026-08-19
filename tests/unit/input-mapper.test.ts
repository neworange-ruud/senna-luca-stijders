import { describe, expect, it } from "vitest";
import { InputMapper } from "../../src/client/input-mapper";

describe("input mapper", () => {
  it("combines movement and action from simultaneous sources", () => {
    const mapper = new InputMapper();
    mapper.press("touch:1", "right");
    mapper.press("touch:2", "jump");
    mapper.keyDown("KeyF");
    expect(mapper.intent).toMatchObject({
      horizontal: 1,
      jump: true,
      attack: true,
    });
    mapper.release("touch:2");
    expect(mapper.intent).toMatchObject({
      horizontal: 1,
      jump: false,
      attack: true,
    });
  });

  it("neutralizes opposing movement without losing held actions", () => {
    const mapper = new InputMapper();
    mapper.keyDown("KeyA");
    mapper.keyDown("ArrowRight");
    mapper.keyDown("ShiftLeft");
    expect(mapper.intent).toMatchObject({ horizontal: 0, block: true });
    mapper.keyUp("ArrowRight");
    expect(mapper.intent.horizontal).toBe(-1);
  });

  it("maps all required keyboard controls and clears stale intent", () => {
    const mapper = new InputMapper();
    for (const code of ["Space", "KeyF", "ShiftRight", "KeyE", "KeyQ"]) {
      expect(mapper.keyDown(code)).not.toBeNull();
    }
    expect(mapper.intent).toMatchObject({
      jump: true,
      attack: true,
      block: true,
      action: true,
      switchWeapon: true,
    });
    expect(mapper.clear()).toMatchObject({
      horizontal: 0,
      jump: false,
      attack: false,
      block: false,
    });
    expect(mapper.keyDown("Escape")).toBeNull();
  });
});
