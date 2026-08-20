import { arenaForWorld, COSMETICS, WORLDS } from "../game/content.js";
import { cameraTarget, followCamera, type Camera } from "../game/camera.js";
import { CHESTS } from "../game/config.js";
import { CHEST_LABELS } from "../game/content.js";
import { hasEffect } from "../game/effects.js";
import { selectedWeapon } from "../game/items.js";
import type {
  ArenaDefinition,
  ChestState,
  EntityState,
  GameSnapshot,
  InputIntent,
  MatchEvent,
  PlayerRole,
  PlayerState,
  WorldId,
} from "../game/types.js";
import { ImageLibrary, spriteRectangle, type AssetName } from "./assets.js";
import {
  interpolatePlayer,
  LocalMovementPrediction,
} from "./movement-presentation.js";
import { frameIndexFor, frameRectangle } from "./sprite-animation.js";

const FRAME_MILLISECONDS = 1_000 / 30;
const EFFECT_MILLISECONDS = 420;
const ROLE_COLOURS: Record<PlayerRole, string> = {
  luca: "#176f9c",
  senna: "#bd4e3c",
};

interface VisualEffect {
  event: MatchEvent;
  shownAt: number;
}

/**
 * Draws the arena from authoritative snapshots. Artwork is optional: whenever
 * a prepared image is not loaded the renderer falls back to the geometric
 * drawing, so the game stays readable and playable either way.
 */
export class CanvasRenderer {
  private snapshot: GameSnapshot | null = null;
  private requestId = 0;
  private camera: Camera = { x: 0, y: 0, width: 1, height: 1 };
  private prediction: LocalMovementPrediction;
  private arena: ArenaDefinition;
  private readonly images = new ImageLibrary();
  private previousRemote: PlayerState | null = null;
  private currentRemote: PlayerState | null = null;
  private remoteReceivedAt = 0;
  private lastFrameAt = 0;
  private accumulator = 0;
  private effects: VisualEffect[] = [];
  private shownEventIds = new Set<string>();
  private readonly reducedMotion: boolean;
  /** The backdrop, already scaled to the height it is drawn at. */
  private scaledBackdrop: {
    key: string;
    canvas: HTMLCanvasElement;
  } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly role: PlayerRole,
    arena: ArenaDefinition = arenaForWorld(null),
  ) {
    this.arena = arena;
    this.prediction = new LocalMovementPrediction(role, this.arena);
    this.images.request(
      ...COSMETICS.map((cosmetic) => `sprite:${cosmetic.id}` as const),
      "icon:sword",
      "icon:weak-sword",
      "icon:nerf",
      "icon:dart",
      "icon:impact",
      "icon:chest",
      "icon:armor",
      "icon:speed",
      "icon:camouflage",
      ...WORLDS.map((world) => `world:${world.id as WorldId}` as const),
    );
    this.reducedMotion =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Accepts a snapshot and returns the authoritative events it introduced, so
   * the page can also turn them into sound and HUD feedback.
   */
  update(snapshot: GameSnapshot): {
    correctionPixels: number;
    events: readonly MatchEvent[];
  } {
    this.snapshot = snapshot;
    this.followWorld(snapshot);
    this.prediction.reconcile(snapshot);
    const remoteRole = this.role === "luca" ? "senna" : "luca";
    this.previousRemote =
      this.currentRemote ?? snapshot.state.match.players[remoteRole];
    this.currentRemote = snapshot.state.match.players[remoteRole];
    this.remoteReceivedAt = performance.now();

    const fresh = snapshot.state.match.events.filter(
      (event) => !this.shownEventIds.has(event.id),
    );
    for (const event of fresh) {
      this.shownEventIds.add(event.id);
      this.effects.push({ event, shownAt: performance.now() });
    }
    if (this.shownEventIds.size > 200) {
      this.shownEventIds = new Set(
        snapshot.state.match.events.map((event) => event.id),
      );
    }
    return {
      correctionPixels: this.prediction.correctionPixels,
      events: fresh,
    };
  }

  setLocalIntent(sequence: number, intent: InputIntent): void {
    this.prediction.setIntent(sequence, intent);
  }

  start(): void {
    if (!this.requestId)
      this.requestId = requestAnimationFrame((now) => this.render(now));
  }

  stop(): void {
    cancelAnimationFrame(this.requestId);
    this.requestId = 0;
  }

  private render(now: number): void {
    if (
      this.lastFrameAt > 0 &&
      this.snapshot?.state.match.phase === "playing"
    ) {
      this.accumulator += Math.min(100, now - this.lastFrameAt);
      while (this.accumulator >= FRAME_MILLISECONDS) {
        this.prediction.advance();
        this.accumulator -= FRAME_MILLISECONDS;
      }
    }
    this.lastFrameAt = now;
    this.effects = this.effects.filter(
      (effect) => now - effect.shownAt < EFFECT_MILLISECONDS,
    );
    this.resize();
    const context = this.canvas.getContext("2d");
    if (context && this.snapshot) this.draw(context, this.snapshot, now);
    this.requestId = requestAnimationFrame((next) => this.render(next));
  }

  private resize(): void {
    const density = Math.min(devicePixelRatio, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * density));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * density));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Follows the world the match is actually being played in. The arena decides
   * collision as well as drawing, so a stale one would predict against the
   * wrong ground and jitter on every correction.
   */
  private followWorld(snapshot: GameSnapshot): void {
    const world = snapshot.state.match.arenaId;
    if (!world || world === this.arena.id) return;
    this.arena = arenaForWorld(world);
    this.prediction = new LocalMovementPrediction(this.role, this.arena);
    this.prediction.reconcile(snapshot);
  }

  private draw(
    context: CanvasRenderingContext2D,
    snapshot: GameSnapshot,
    now: number,
  ): void {
    const density = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    context.setTransform(density, 0, 0, density, 0, 0);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const localPlayer =
      this.prediction.predictedPlayer ??
      snapshot.state.match.players[this.role];
    const target = cameraTarget(
      { ...localPlayer.position, ...localPlayer.size },
      { width, height },
      this.arena.bounds,
    );
    this.camera =
      this.camera.width === 1 ? target : followCamera(this.camera, target);

    this.drawBackground(
      context,
      width,
      height,
      snapshot.state.match.arenaId ?? (this.arena.id as WorldId),
    );
    context.save();
    context.translate(-this.camera.x, -this.camera.y);
    this.drawSurfaces(context);
    this.drawTeleports(context, now);
    for (const chest of snapshot.state.match.chests) {
      this.drawChest(context, chest, snapshot.tick, now);
    }
    for (const entity of snapshot.state.match.entities) {
      if (!this.isVisible({ ...entity.position, ...entity.size })) continue;
      this.drawEntity(context, entity, now);
    }

    const remoteRole = this.role === "luca" ? "senna" : "luca";
    const remotePlayer =
      this.previousRemote && this.currentRemote
        ? interpolatePlayer(
            this.previousRemote,
            this.currentRemote,
            (now - this.remoteReceivedAt) / (1_000 / 15),
          )
        : snapshot.state.match.players[remoteRole];
    for (const role of ["luca", "senna"] as const) {
      const fighter = role === this.role ? localPlayer : remotePlayer;
      // Camouflage only dims the opponent's outline, never your own body, and
      // never enough to make them invisible.
      const camouflaged =
        role !== this.role && hasEffect(fighter, "camouflage");
      context.globalAlpha = camouflaged ? 0.45 : 1;
      this.drawFighter(context, fighter, snapshot, now);
      context.globalAlpha = 1;
    }
    this.drawEffects(context, now);
    context.restore();
  }

  private drawBackground(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    world: WorldId,
  ): void {
    const backdrop = this.images.get(`world:${world}`);
    if (!backdrop) {
      const sky = context.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#89d5e8");
      sky.addColorStop(1, "#f8df93");
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);
      return;
    }
    // Resampling a full backdrop on every frame is the most expensive thing
    // this renderer does, and the result is the same every time, so it is
    // scaled once and then copied pixel for pixel.
    const scale = height / backdrop.height;
    const drawWidth = Math.max(1, Math.round(backdrop.width * scale));
    const key = `${world}:${drawWidth}x${Math.round(height)}`;
    if (this.scaledBackdrop?.key !== key) {
      const scaled = document.createElement("canvas");
      scaled.width = drawWidth;
      scaled.height = Math.max(1, Math.round(height));
      const scaledContext = scaled.getContext("2d");
      if (!scaledContext) return;
      scaledContext.drawImage(backdrop, 0, 0, scaled.width, scaled.height);
      this.scaledBackdrop = { key, canvas: scaled };
    }
    const prepared = this.scaledBackdrop.canvas;
    // The backdrop pans slower than the arena, which reads as depth without
    // moving anything the players can stand on.
    const span = Math.max(1, this.arena.bounds.width - width);
    const offset = Math.round(
      -(this.camera.x / span) * Math.max(0, drawWidth - width),
    );
    context.drawImage(prepared, offset, 0);
    if (drawWidth + offset < width) {
      context.drawImage(prepared, offset + drawWidth, 0);
    }
  }

  /** True when a box is somewhere the camera can actually see. */
  private isVisible(box: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): boolean {
    const margin = 64;
    return (
      box.x + box.width >= this.camera.x - margin &&
      box.x <= this.camera.x + this.camera.width + margin &&
      box.y + box.height >= this.camera.y - margin &&
      box.y <= this.camera.y + this.camera.height + margin
    );
  }

  private drawSurfaces(context: CanvasRenderingContext2D): void {
    for (const surface of this.arena.surfaces) {
      // A world is up to 3200 units wide while the camera shows a fraction of
      // it, so most of the geometry is off screen on every frame.
      if (!this.isVisible(surface)) continue;
      context.fillStyle =
        surface.kind === "floor"
          ? "#e2be76"
          : surface.kind === "cover"
            ? "#9a6135"
            : "#4b7a58";
      context.beginPath();
      context.roundRect(
        surface.x,
        surface.y,
        surface.width,
        surface.height,
        surface.kind === "floor" ? 0 : 10,
      );
      context.fill();
      context.strokeStyle = "#2b1d10";
      context.lineWidth = 4;
      context.stroke();
    }
  }

  /**
   * Draws each lift as a lit doorway with its own name. Two lifts that lead to
   * each other carry the same name, which is how a child sees where it goes
   * without reading a menu.
   */
  private drawTeleports(context: CanvasRenderingContext2D, now: number): void {
    const pulse = this.reducedMotion ? 0.7 : 0.55 + 0.25 * Math.sin(now / 320);
    for (const teleport of this.arena.teleports) {
      const width = 92;
      const height = 132;
      const x = teleport.x - width / 2;
      const y = teleport.y - height;
      if (!this.isVisible({ x, y, width, height })) continue;

      context.fillStyle = "#1d2b4a";
      context.beginPath();
      context.roundRect(x, y, width, height, 14);
      context.fill();
      context.strokeStyle = "#f5d67b";
      context.lineWidth = 5;
      context.stroke();

      context.globalAlpha = pulse;
      context.fillStyle = "#8fd8ff";
      context.beginPath();
      context.roundRect(x + 14, y + 16, width - 28, height - 30, 10);
      context.fill();
      context.globalAlpha = 1;

      // The arrow says which way this lift travels, up or down.
      const upwards = teleport.y > 1_000;
      context.fillStyle = "#0d1a30";
      context.beginPath();
      const centre = teleport.x;
      const tip = upwards ? y + 40 : y + height - 44;
      const base = upwards ? y + 84 : y + height - 88;
      context.moveTo(centre, tip);
      context.lineTo(centre - 22, base);
      context.lineTo(centre + 22, base);
      context.closePath();
      context.fill();

      context.font = "600 26px system-ui, sans-serif";
      context.fillStyle = "#0d1a30";
      context.textAlign = "center";
      context.fillText(teleport.label, centre, y - 12);
      context.textAlign = "left";
    }
  }

  private drawFighter(
    context: CanvasRenderingContext2D,
    fighter: PlayerState,
    snapshot: GameSnapshot,
    now: number,
  ): void {
    const box = { ...fighter.position, ...fighter.size };
    const colour = ROLE_COLOURS[fighter.role];

    // A coloured pad under each fighter keeps the two of them apart at a
    // glance, which colour alone on the sprite would not guarantee.
    context.fillStyle = colour;
    context.globalAlpha = 0.35;
    context.beginPath();
    context.ellipse(
      box.x + box.width / 2,
      box.y + box.height - 4,
      box.width * 0.55,
      10,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.globalAlpha = 1;

    // The sheet belongs to the outfit this child picked, and both children use
    // the same character, so who is who is told by the name and the pad.
    const sheet = fighter.cosmetic
      ? this.images.get(`sprite:${fighter.cosmetic}`)
      : null;
    if (sheet) {
      const frame = frameRectangle(sheet, frameIndexFor(fighter, now));
      const target = spriteRectangle(box, frame);
      context.save();
      if (fighter.facing === "left") {
        context.translate(target.x + target.width / 2, 0);
        context.scale(-1, 1);
        context.translate(-(target.x + target.width / 2), 0);
      }
      if (fighter.input.block) {
        // Blocking crouches the fighter slightly, matching the slower movement.
        context.translate(0, target.height * 0.06);
      }
      context.drawImage(
        sheet,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        target.x,
        target.y,
        target.width,
        target.height,
      );
      context.restore();
    } else {
      context.fillStyle = colour;
      context.beginPath();
      context.roundRect(
        box.x,
        box.y,
        box.width,
        box.height,
        fighter.role === "luca" ? [20, 30, 12, 25] : [30, 18, 28, 12],
      );
      context.fill();
      context.strokeStyle = "#10283b";
      context.lineWidth = 5;
      context.stroke();
    }

    if (fighter.invulnerableUntilTick > snapshot.tick) {
      context.strokeStyle = "#fff1a8";
      context.lineWidth = 6;
      context.beginPath();
      context.roundRect(
        box.x - 6,
        box.y - 6,
        box.width + 12,
        box.height + 12,
        16,
      );
      context.stroke();
    }
    if (fighter.input.block) {
      this.drawShield(context, fighter);
    }
    const weapon = selectedWeapon(fighter);
    if (weapon !== "unarmed") {
      const icon = this.images.get(`icon:${weapon}`);
      if (icon) {
        const size = 46;
        const x =
          fighter.facing === "right" ? box.x + box.width - 8 : box.x - size + 8;
        context.drawImage(icon, x, box.y + box.height * 0.45, size, size);
      }
    }

    // The outfit is drawn on the character itself, so the badge above the head
    // is only needed while the artwork has not arrived.
    if (!sheet) this.drawCosmetic(context, fighter);
    // Active powers ride above both fighters, so each player can see what the
    // other one picked up and not only what they hold themselves.
    fighter.effects.forEach((effect, index) => {
      const icon = this.images.get(`icon:${effect.effectId}`);
      const size = 28;
      const x = box.x + box.width / 2 - size / 2 + (index - 1) * (size + 4);
      const y = box.y - 74;
      if (icon) {
        context.drawImage(icon, x, y, size, size);
      } else {
        context.fillStyle = "#f5bd34";
        context.fillRect(x, y, size, size);
      }
    });
    context.fillStyle = "#10283b";
    context.font = "900 20px system-ui";
    context.textAlign = "center";
    context.fillText(
      fighter.role === "luca" ? "Luca" : "Senna",
      box.x + box.width / 2,
      box.y - 42,
    );
  }

  /**
   * Draws an announced chest falling towards its point and a landed chest
   * waiting to be opened. Both carry a Dutch label, so the state never depends
   * on recognising the drawing alone.
   */
  private drawChest(
    context: CanvasRenderingContext2D,
    chest: ChestState,
    tick: number,
    now: number,
  ): void {
    const size = 64;
    const landed = tick >= chest.landsAtTick;
    const fall = landed
      ? 0
      : Math.max(0, ((chest.landsAtTick - tick) / CHESTS.announceTicks) * 260);
    const bob = landed && !this.reducedMotion ? Math.sin(now / 240) * 4 : 0;
    const x = chest.position.x - size / 2;
    const y = chest.position.y - size - fall + bob;

    if (!landed) {
      // A marker on the ground shows exactly where it will land.
      context.strokeStyle = "#b8202a";
      context.lineWidth = 5;
      context.setLineDash(this.reducedMotion ? [] : [12, 8]);
      context.beginPath();
      context.ellipse(
        chest.position.x,
        chest.position.y - 6,
        size * 0.6,
        14,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.setLineDash([]);
    }

    const icon = this.images.get("icon:chest");
    if (icon) {
      context.drawImage(icon, x, y, size, size);
    } else {
      context.fillStyle = chest.recovery ? "#e0a13c" : "#c98a3d";
      context.fillRect(x, y, size, size);
      context.strokeStyle = "#4a2d12";
      context.lineWidth = 4;
      context.strokeRect(x, y, size, size);
    }
    context.fillStyle = "#10283b";
    context.font = "900 20px system-ui";
    context.textAlign = "center";
    context.fillText(
      landed ? "Kist! Pak op" : "Kist komt...",
      chest.position.x,
      y - 12,
    );
  }

  /** The chosen cosmetic rides above the head as a silhouette decoration. */
  private drawCosmetic(
    context: CanvasRenderingContext2D,
    fighter: PlayerState,
  ): void {
    if (!fighter.cosmetic) return;
    const icon = this.images.get(`icon:cosmetic-${fighter.cosmetic}`);
    if (!icon) return;
    const size = fighter.size.width * 0.7;
    context.drawImage(
      icon,
      fighter.position.x + fighter.size.width / 2 - size / 2,
      fighter.position.y - size * 0.5,
      size,
      size,
    );
  }

  private drawShield(
    context: CanvasRenderingContext2D,
    fighter: PlayerState,
  ): void {
    const direction = fighter.facing === "right" ? 1 : -1;
    const x =
      fighter.position.x + (direction > 0 ? fighter.size.width + 6 : -18);
    context.fillStyle = "rgba(120, 190, 255, 0.55)";
    context.strokeStyle = "#2b6ea8";
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(
      x,
      fighter.position.y + 12,
      12,
      fighter.size.height - 24,
      6,
    );
    context.fill();
    context.stroke();
  }

  private drawEntity(
    context: CanvasRenderingContext2D,
    entity: EntityState,
    now: number,
  ): void {
    const icon = this.images.get(
      entity.itemId === "nerf" && entity.kind === "projectile"
        ? "icon:dart"
        : (`icon:${entity.itemId}` as AssetName),
    );
    const bob = entity.kind === "dropped-item" ? Math.sin(now / 260) * 4 : 0;
    if (icon) {
      context.save();
      context.translate(
        entity.position.x + entity.size.width / 2,
        entity.position.y + entity.size.height / 2 + bob,
      );
      if (entity.facing === "left") context.scale(-1, 1);
      const height = Math.max(entity.size.height, entity.size.width * 0.6);
      context.drawImage(
        icon,
        -entity.size.width / 2,
        -height / 2,
        entity.size.width,
        height,
      );
      context.restore();
    } else {
      context.fillStyle = entity.kind === "projectile" ? "#f08a24" : "#c9d3dd";
      context.fillRect(
        entity.position.x,
        entity.position.y + bob,
        entity.size.width,
        entity.size.height,
      );
    }
    if (entity.kind === "dropped-item") {
      context.fillStyle = "#10283b";
      context.font = "700 16px system-ui";
      context.textAlign = "center";
      context.fillText(
        "Pak op",
        entity.position.x + entity.size.width / 2,
        entity.position.y - 10 + bob,
      );
    }
  }

  private drawEffects(context: CanvasRenderingContext2D, now: number): void {
    for (const effect of this.effects) {
      const age = (now - effect.shownAt) / EFFECT_MILLISECONDS;
      const { event } = effect;
      if (
        !["melee", "impact", "pickup", "chest-claimed"].includes(event.kind)
      ) {
        continue;
      }
      context.globalAlpha = Math.max(0, 1 - age);
      const x = event.position.x + 32;
      const y = event.position.y + 40 - age * 26;
      if (event.outcome === "hit") {
        const impact = this.images.get("icon:impact");
        const size = 64 + age * 24;
        if (impact) {
          context.drawImage(impact, x - size / 2, y - size / 2, size, size);
        } else {
          context.fillStyle = "#ffd23f";
          context.beginPath();
          context.arc(x, y, size / 3, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = "#b8202a";
        context.font = "900 26px system-ui";
        context.textAlign = "center";
        context.fillText(`-${event.damage}`, x, y - 34);
      } else if (event.outcome === "blocked" || event.outcome === "protected") {
        context.fillStyle = "#2b6ea8";
        context.font = "900 22px system-ui";
        context.textAlign = "center";
        context.fillText(
          event.outcome === "blocked" ? "Geblokt!" : "Beschermd!",
          x,
          y,
        );
      } else if (event.kind === "pickup") {
        context.fillStyle = "#1d7a46";
        context.font = "900 22px system-ui";
        context.textAlign = "center";
        context.fillText("Opgepakt!", x, y);
      } else if (event.kind === "chest-claimed" && event.chestOutcome) {
        // Icon plus Dutch word, so the reward never depends on the picture.
        const grow = this.reducedMotion ? 1 : 1 + (1 - age) * 0.25;
        const icon = this.images.get(`icon:${event.chestOutcome}`);
        const size = 56 * grow;
        if (icon) context.drawImage(icon, x - size / 2, y - size, size, size);
        context.fillStyle = "#10283b";
        context.font = "900 24px system-ui";
        context.textAlign = "center";
        context.fillText(CHEST_LABELS[event.chestOutcome], x, y + 26);
      }
      context.globalAlpha = 1;
    }
  }
}
