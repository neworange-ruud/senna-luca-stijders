import { NERF } from "./config.js";
import type { GameState, ItemId, ItemState, PlayerState } from "./types.js";

/** Two weapon slots plus always-available unarmed combat. */
export const WEAPON_SLOTS = 2;
export const UNARMED_SLOT = -1;

export type SelectedWeapon = ItemId | "unarmed";

export function createItem(
  state: GameState,
  itemId: ItemId,
  owner: PlayerState["role"] | null,
): ItemState {
  const number = state.match.nextEntityNumber;
  state.match.nextEntityNumber += 1;
  return {
    id: `${itemId}-${number}`,
    itemId,
    owner,
    ammo: itemId === "nerf" ? NERF.ammo : null,
  };
}

export function selectedItem(player: PlayerState): ItemState | null {
  return player.inventory[player.selectedSlot] ?? null;
}

export function selectedWeapon(player: PlayerState): SelectedWeapon {
  return selectedItem(player)?.itemId ?? "unarmed";
}

/**
 * Cycles unarmed, slot one, slot two and back. Empty slots are skipped so the
 * switch control always lands on something usable, and an empty blaster stays
 * selectable until it is replaced.
 */
export function switchWeapon(player: PlayerState): SelectedWeapon {
  const options = [UNARMED_SLOT, ...player.inventory.map((_, index) => index)];
  const current = options.indexOf(player.selectedSlot);
  player.selectedSlot = options[(current + 1) % options.length] ?? UNARMED_SLOT;
  return selectedWeapon(player);
}

/**
 * Puts a weapon in the player's hands. A free slot is filled first; otherwise
 * the currently held weapon is replaced and returned so the caller can drop it
 * back into the arena as a recoverable item.
 */
export function giveItem(
  player: PlayerState,
  item: ItemState,
): ItemState | null {
  const owned: ItemState[] = [...player.inventory];
  const claimed = { ...item, owner: player.role };
  if (owned.length < WEAPON_SLOTS) {
    owned.push(claimed);
    player.inventory = owned;
    player.selectedSlot = owned.length - 1;
    return null;
  }
  const slot =
    player.selectedSlot >= 0 && player.selectedSlot < owned.length
      ? player.selectedSlot
      : 0;
  const replaced = owned[slot]!;
  owned[slot] = claimed;
  player.inventory = owned;
  player.selectedSlot = slot;
  return replaced;
}

/** Removes the held weapon, for example when a sword is thrown. */
export function removeSelectedItem(player: PlayerState): ItemState | null {
  const item = selectedItem(player);
  if (!item) return null;
  player.inventory = player.inventory.filter(
    (candidate) => candidate.id !== item.id,
  );
  player.selectedSlot = player.inventory.length > 0 ? 0 : UNARMED_SLOT;
  return item;
}

/** Spends one dart. Returns false when the blaster is empty. */
export function consumeAmmo(player: PlayerState): boolean {
  const item = selectedItem(player);
  if (!item || item.ammo === null || item.ammo <= 0) return false;
  player.inventory = player.inventory.map((candidate) =>
    candidate.id === item.id
      ? { ...candidate, ammo: (candidate.ammo ?? 0) - 1 }
      : candidate,
  );
  return true;
}
