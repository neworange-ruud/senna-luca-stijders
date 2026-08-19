import type { MatchEvent } from "../game/types.js";

export type SoundName =
  | "jump"
  | "swing"
  | "hit"
  | "block"
  | "throw"
  | "shoot"
  | "empty"
  | "pickup"
  | "countdown"
  | "start"
  | "win"
  | "lose";

export interface SoundRecipe {
  /** Start and end frequency in hertz; the tone slides between them. */
  from: number;
  to: number;
  seconds: number;
  type: OscillatorType;
  /** Amount of noise mixed in, for impacts rather than tones. */
  noise: number;
  gain: number;
}

/**
 * Every sound is synthesised, so the game ships no third-party audio and works
 * offline. The recipes are plain data so the mapping from gameplay to sound can
 * be tested without an audio device.
 */
export const SOUNDS: Readonly<Record<SoundName, SoundRecipe>> = {
  jump: {
    from: 320,
    to: 640,
    seconds: 0.14,
    type: "triangle",
    noise: 0,
    gain: 0.3,
  },
  swing: {
    from: 700,
    to: 180,
    seconds: 0.12,
    type: "sawtooth",
    noise: 0.6,
    gain: 0.25,
  },
  hit: {
    from: 220,
    to: 70,
    seconds: 0.22,
    type: "square",
    noise: 0.5,
    gain: 0.42,
  },
  block: {
    from: 900,
    to: 520,
    seconds: 0.16,
    type: "square",
    noise: 0.25,
    gain: 0.34,
  },
  throw: {
    from: 240,
    to: 820,
    seconds: 0.2,
    type: "sine",
    noise: 0.35,
    gain: 0.32,
  },
  shoot: {
    from: 620,
    to: 240,
    seconds: 0.1,
    type: "square",
    noise: 0.2,
    gain: 0.3,
  },
  empty: {
    from: 180,
    to: 150,
    seconds: 0.07,
    type: "square",
    noise: 0.1,
    gain: 0.22,
  },
  pickup: {
    from: 520,
    to: 980,
    seconds: 0.22,
    type: "triangle",
    noise: 0,
    gain: 0.34,
  },
  countdown: {
    from: 440,
    to: 440,
    seconds: 0.12,
    type: "sine",
    noise: 0,
    gain: 0.3,
  },
  start: {
    from: 660,
    to: 990,
    seconds: 0.3,
    type: "sine",
    noise: 0,
    gain: 0.34,
  },
  win: {
    from: 523,
    to: 1_046,
    seconds: 0.5,
    type: "triangle",
    noise: 0,
    gain: 0.36,
  },
  lose: {
    from: 392,
    to: 196,
    seconds: 0.5,
    type: "triangle",
    noise: 0,
    gain: 0.32,
  },
};

/** A simple friendly loop, as semitone offsets from the base note. */
const MUSIC_STEPS = [0, 4, 7, 12, 7, 4, 0, -5];
const MUSIC_BASE_HERTZ = 196;
const MUSIC_STEP_SECONDS = 0.42;

/** The sound an authoritative match event should make, if any. */
export function soundForEvent(event: MatchEvent): SoundName | null {
  switch (event.kind) {
    case "melee":
      return event.outcome === "hit"
        ? "hit"
        : event.outcome === "blocked" || event.outcome === "protected"
          ? "block"
          : "swing";
    case "impact":
      return event.outcome === "hit" ? "hit" : "block";
    case "throw":
      return "throw";
    case "shoot":
      return "shoot";
    case "empty":
      return "empty";
    case "pickup":
    case "drop":
      return "pickup";
    case "respawn":
      return "start";
    case "chest-announced":
      return "countdown";
    case "chest-landed":
      return "start";
    case "chest-claimed":
      return "win";
    case "effect-ended":
      return "empty";
    default:
      return null;
  }
}

interface StoredPreferences {
  effectsMuted: boolean;
  musicMuted: boolean;
}

const STORAGE_KEY = "strijders.audio";

export function readPreferences(
  storage: Pick<Storage, "getItem"> | null,
): StoredPreferences {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredPreferences>) : {};
    return {
      effectsMuted: parsed.effectsMuted === true,
      musicMuted: parsed.musicMuted !== false,
    };
  } catch {
    // A blocked or corrupt store must never stop the game from starting.
    return { effectsMuted: false, musicMuted: true };
  }
}

/**
 * Synthesised effects and music with independent, persistent mute controls.
 * Nothing is created before a real user gesture, so no browser blocks or warns
 * about autoplay, and gameplay never depends on audio being available.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private musicTimer: number | undefined;
  private musicStep = 0;
  private preferences: StoredPreferences;

  constructor(
    private readonly storage: Storage | null = typeof localStorage ===
    "undefined"
      ? null
      : localStorage,
  ) {
    this.preferences = readPreferences(this.storage);
  }

  get effectsMuted(): boolean {
    return this.preferences.effectsMuted;
  }

  get musicMuted(): boolean {
    return this.preferences.musicMuted;
  }

  /** Called from a user gesture; before this no audio node exists at all. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Constructor =
      typeof AudioContext === "undefined" ? null : AudioContext;
    if (!Constructor) return;
    this.context = new Constructor();
    this.effects = this.context.createGain();
    this.music = this.context.createGain();
    this.effects.connect(this.context.destination);
    this.music.connect(this.context.destination);
    this.applyVolumes();
    this.scheduleMusic();
  }

  setEffectsMuted(muted: boolean): void {
    this.preferences = { ...this.preferences, effectsMuted: muted };
    this.persist();
    this.applyVolumes();
  }

  setMusicMuted(muted: boolean): void {
    this.preferences = { ...this.preferences, musicMuted: muted };
    this.persist();
    this.applyVolumes();
    this.scheduleMusic();
  }

  play(name: SoundName): void {
    const context = this.context;
    const output = this.effects;
    if (!context || !output || this.preferences.effectsMuted) return;
    const recipe = SOUNDS[name];
    const now = context.currentTime;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(recipe.gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + recipe.seconds);
    envelope.connect(output);

    const oscillator = context.createOscillator();
    oscillator.type = recipe.type;
    oscillator.frequency.setValueAtTime(recipe.from, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, recipe.to),
      now + recipe.seconds,
    );
    oscillator.connect(envelope);
    oscillator.start(now);
    oscillator.stop(now + recipe.seconds);

    if (recipe.noise > 0) {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer(context, recipe.seconds);
      const noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(recipe.gain * recipe.noise, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + recipe.seconds);
      source.connect(noiseGain).connect(output);
      source.start(now);
      source.stop(now + recipe.seconds);
    }
  }

  /** Plays the sounds for a batch of authoritative events. */
  playEvents(events: readonly MatchEvent[]): void {
    for (const event of events) {
      const sound = soundForEvent(event);
      if (sound) this.play(sound);
    }
  }

  stop(): void {
    if (this.musicTimer !== undefined) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    void this.context?.close();
    this.context = null;
  }

  private noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frames; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private scheduleMusic(): void {
    if (this.musicTimer !== undefined) {
      clearInterval(this.musicTimer);
      this.musicTimer = undefined;
    }
    if (!this.context || this.preferences.musicMuted) return;
    this.musicTimer = setInterval(() => {
      this.playMusicStep();
    }, MUSIC_STEP_SECONDS * 1_000) as unknown as number;
  }

  private playMusicStep(): void {
    const context = this.context;
    const output = this.music;
    if (!context || !output) return;
    const step = MUSIC_STEPS[this.musicStep % MUSIC_STEPS.length] ?? 0;
    this.musicStep += 1;
    const now = context.currentTime;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    envelope.connect(output);
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(
      MUSIC_BASE_HERTZ * Math.pow(2, step / 12),
      now,
    );
    oscillator.connect(envelope);
    oscillator.start(now);
    oscillator.stop(now + 0.42);
  }

  private applyVolumes(): void {
    if (this.effects) {
      this.effects.gain.value = this.preferences.effectsMuted ? 0 : 1;
    }
    if (this.music) {
      this.music.gain.value = this.preferences.musicMuted ? 0 : 0.5;
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
    } catch {
      // Private browsing can refuse storage; the setting then lasts one session.
    }
  }
}
