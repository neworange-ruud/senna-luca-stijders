import { EMPTY_INPUT, type InputIntent } from "../game/types.js";

export type ControlAction =
  "left" | "right" | "jump" | "attack" | "block" | "action" | "switchWeapon";

const KEY_ACTIONS: Readonly<Record<string, ControlAction>> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "jump",
  KeyF: "attack",
  ShiftLeft: "block",
  ShiftRight: "block",
  KeyE: "action",
  KeyQ: "switchWeapon",
};

export class InputMapper {
  private readonly active = new Map<string, ControlAction>();

  press(sourceId: string, action: ControlAction): InputIntent {
    this.active.set(sourceId, action);
    return this.intent;
  }

  release(sourceId: string): InputIntent {
    this.active.delete(sourceId);
    return this.intent;
  }

  clear(): InputIntent {
    this.active.clear();
    return this.intent;
  }

  keyDown(code: string): InputIntent | null {
    const action = KEY_ACTIONS[code];
    return action ? this.press(`key:${code}`, action) : null;
  }

  keyUp(code: string): InputIntent | null {
    return KEY_ACTIONS[code] ? this.release(`key:${code}`) : null;
  }

  get intent(): InputIntent {
    const actions = new Set(this.active.values());
    const left = actions.has("left");
    const right = actions.has("right");
    return {
      ...EMPTY_INPUT,
      horizontal: left === right ? 0 : left ? -1 : 1,
      jump: actions.has("jump"),
      attack: actions.has("attack"),
      block: actions.has("block"),
      action: actions.has("action"),
      switchWeapon: actions.has("switchWeapon"),
    };
  }
}
