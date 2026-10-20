// Plays a pre-rendered shadowing session (render.ts) through an HTMLAudioElement and the Media
// Session API, so it continues with the screen locked and is controlled from the lock screen /
// notification / headset (play, pause, next, previous, seek).
//
// Everything is derived from the audio position: which item and step is current, which items were
// heard to the end. No timer drives playback — while the page is suspended in the background the
// browser keeps playing the file, and the state is reconciled as soon as scripts run again.
// The snapshot has the same shape as ShadowingPlayer's, so the session UI is shared.

import type { WordId } from '../../../models/vocabulary';
import type { PlayerNotice, PlayerSnapshot, PlayerStatus } from '../player';
import type { RenderedSession, TimedItem } from './render';

export interface AudioLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

type Action = 'play' | 'pause' | 'stop' | 'previoustrack' | 'nexttrack' | 'seekbackward' | 'seekforward' | 'seekto';

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: Action, handler: ((details: { seekTime?: number; seekOffset?: number }) => void) | null): void;
  setPositionState?(state: { duration: number; playbackRate: number; position: number }): void;
}

export interface AudioSessionOptions {
  audio?: AudioLike;
  /** null = no Media Session (unsupported browser). */
  mediaSession?: MediaSessionLike | null;
  createMetadata?: (init: { title: string; artist: string; album: string; artwork: Array<{ src: string; sizes: string; type: string }> }) => unknown;
  urls?: { create(blob: Blob): string; revoke(url: string): void };
  now?: () => number;
  onItemCompleted?: (id: WordId) => void;
  onFinished?: (snapshot: PlayerSnapshot) => void;
}

const SEEK_STEP_S = 10;
/** Seconds into an item after which "previous" restarts the item instead of going back. */
const RESTART_WITHIN_S = 2;

function browserMediaSession(): MediaSessionLike | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? (navigator.mediaSession as unknown as MediaSessionLike) : null;
}

function browserMetadata(init: Parameters<NonNullable<AudioSessionOptions['createMetadata']>>[0]): unknown {
  return typeof MediaMetadata === 'undefined' ? null : new MediaMetadata(init);
}

/** iOS 17+ / Safari: play as media (also with the silent switch on, and in the background). */
function preferPlaybackAudioSession() {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
  } catch { /* not supported */ }
}

export class AudioSessionPlayer {
  private readonly audio: AudioLike;
  private readonly media: MediaSessionLike | null;
  private readonly urls: NonNullable<AudioSessionOptions['urls']>;
  private readonly now: () => number;
  private readonly url: string;
  private readonly listeners = new Set<() => void>();
  private readonly detach: Array<() => void> = [];
  private status: PlayerStatus = 'idle';
  private notice: PlayerNotice | null = null;
  private index = 0;
  private stepIndex = 0;
  private completed: WordId[] = [];
  private readonly completedSet = new Set<WordId>();
  /** Position of the last natural progress check (null right after a seek). */
  private lastT: number | null = 0;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private endedEarly = false;
  private disposed = false;
  private metaIndex = -1;
  private snapshot: PlayerSnapshot;

  constructor(private readonly session: RenderedSession, private readonly o: AudioSessionOptions = {}) {
    this.audio = o.audio ?? (new Audio() as unknown as AudioLike);
    this.media = o.mediaSession === undefined ? browserMediaSession() : o.mediaSession;
    this.urls = o.urls ?? { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) };
    this.now = o.now ?? Date.now;
    this.url = this.urls.create(session.wav);
    this.audio.preload = 'auto';
    this.audio.src = this.url;
    this.on('timeupdate', () => this.sync());
    this.on('seeking', () => { this.lastT = null; });
    this.on('seeked', () => { this.lastT = this.audio.currentTime; this.sync(); this.position(); });
    this.on('play', () => { if (this.status !== 'finished') { this.status = 'playing'; this.notice = null; this.mediaState(); this.emit(); } });
    this.on('pause', () => { if (this.status === 'playing') { this.status = 'paused'; this.mediaState(); this.emit(); } });
    this.on('ended', () => { this.sync(); this.finish(false); });
    this.on('error', () => { if (this.status !== 'finished') { this.status = 'paused'; this.notice = 'speech-failed'; this.emit(); } });
    this.installMediaSession();
    this.snapshot = this.build();
  }

  // ── observation ──────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  get items(): readonly TimedItem[] { return this.session.items; }

  // ── controls (same contract as ShadowingPlayer) ─────────────────────────

  /** Call from a user gesture the first time (autoplay policies). */
  play(): void {
    if (this.disposed || this.status === 'playing' || this.status === 'finished') return;
    if (!this.session.items.length) { this.finish(false); return; }
    preferPlaybackAudioSession();
    this.startedAt ??= this.now();
    this.status = 'playing';
    this.notice = null;
    this.mediaState();
    this.emit();
    this.audio.play().catch((e: unknown) => {
      if (this.disposed || this.status === 'finished') return;
      this.status = 'paused';
      this.notice = (e as { name?: string })?.name === 'NotAllowedError' ? 'blocked' : 'speech-failed';
      this.mediaState();
      this.emit();
    });
  }

  pause(notice: PlayerNotice | null = null): void {
    if (this.status !== 'playing') return;
    this.status = 'paused';
    this.notice = notice;
    this.audio.pause();
    this.mediaState();
    this.emit();
  }

  /** Stops and rewinds to the beginning of the current item. */
  stop(): void {
    if (this.status === 'finished') return;
    this.audio.pause();
    this.status = 'idle';
    this.notice = null;
    this.seek(this.session.items[this.index]?.start ?? 0);
    this.mediaState();
    this.emit();
  }

  next(): void {
    if (this.status === 'finished') return;
    if (this.index >= this.session.items.length - 1) { this.end(); return; }
    this.seek(this.session.items[this.index + 1]!.start);
  }

  /** Previous item; early in an item (or on the first) it restarts that item. */
  previous(): void {
    if (this.status === 'finished') return;
    const item = this.session.items[this.index];
    if (!item) return;
    const into = this.audio.currentTime - item.start;
    const target = into > RESTART_WITHIN_S || this.index === 0 ? item.start : this.session.items[this.index - 1]!.start;
    this.seek(target);
  }

  end(): void {
    if (this.status === 'finished') return;
    this.finish(this.completed.length < this.session.items.length);
  }

  dispose(): void {
    if (this.disposed) return;
    this.audio.pause();
    this.disposed = true;
    for (const off of this.detach) off();
    this.clearMediaSession();
    this.audio.removeAttribute('src');
    try { this.audio.load(); } catch { /* ignore */ }
    this.urls.revoke(this.url);
    this.listeners.clear();
  }

  // ── engine ───────────────────────────────────────────────────────────────

  private on(type: string, fn: () => void) {
    const guarded = () => { if (!this.disposed) fn(); };
    this.audio.addEventListener(type, guarded);
    this.detach.push(() => this.audio.removeEventListener(type, guarded));
  }

  private seek(t: number) {
    const clamped = Math.max(0, Math.min(t, this.session.duration));
    this.lastT = null; // a jump: skipped items do not count as practised
    this.audio.currentTime = clamped;
    this.locate(clamped);
    this.lastT = clamped;
    this.position();
    this.emit();
  }

  /** Reconciles the state with the audio position (after timeupdate, seeks, or a long suspension). */
  private sync() {
    const t = this.audio.currentTime;
    if (this.lastT !== null && t >= this.lastT) {
      for (const item of this.session.items) {
        if (item.end > this.lastT + 1e-3 && item.end <= t + 0.05 && !this.completedSet.has(item.id)) this.complete(item.id);
      }
    }
    this.lastT = t;
    const before = `${this.index}:${this.stepIndex}`;
    this.locate(t);
    if (`${this.index}:${this.stepIndex}` !== before) { this.position(); this.emit(); }
  }

  private complete(id: WordId) {
    this.completedSet.add(id);
    this.completed = [...this.completed, id];
    this.o.onItemCompleted?.(id);
    this.emit();
  }

  private locate(t: number) {
    const items = this.session.items;
    let i = 0;
    while (i < items.length - 1 && t >= items[i + 1]!.start) i++;
    const steps = items[i]?.steps ?? [];
    let s = 0;
    while (s < steps.length - 1 && t >= steps[s + 1]!.start) s++;
    this.index = i;
    this.stepIndex = s;
  }

  private finish(early: boolean) {
    if (this.status === 'finished') return;
    this.audio.pause();
    this.status = 'finished';
    this.endedEarly = early;
    this.finishedAt = this.now();
    this.mediaState();
    this.emit();
    this.o.onFinished?.(this.snapshot);
  }

  // ── Media Session (lock screen, notification, headset buttons) ───────────

  private installMediaSession() {
    const m = this.media;
    if (!m) return;
    const set = (action: Action, handler: (d: { seekTime?: number; seekOffset?: number }) => void) => {
      try { m.setActionHandler(action, (d) => { if (!this.disposed) handler(d ?? {}); }); } catch { /* action not supported */ }
    };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('stop', () => this.stop());
    set('nexttrack', () => this.next());
    set('previoustrack', () => this.previous());
    set('seekbackward', (d) => this.seek(this.audio.currentTime - (d.seekOffset ?? SEEK_STEP_S)));
    set('seekforward', (d) => this.seek(this.audio.currentTime + (d.seekOffset ?? SEEK_STEP_S)));
    set('seekto', (d) => { if (typeof d.seekTime === 'number') this.seek(d.seekTime); });
    this.metadata();
  }

  private clearMediaSession() {
    const m = this.media;
    if (!m) return;
    for (const a of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'] as const) {
      try { m.setActionHandler(a, null); } catch { /* ignore */ }
    }
    try { m.metadata = null; m.playbackState = 'none'; } catch { /* ignore */ }
  }

  /** Lock-screen text: position only — no vocabulary is shown on the lock screen. */
  private metadata() {
    if (!this.media || this.metaIndex === this.index) return;
    this.metaIndex = this.index;
    const make = this.o.createMetadata ?? browserMetadata;
    try {
      this.media.metadata = make({
        title: `Shadowing · Wort ${this.index + 1} / ${this.session.items.length}`,
        artist: 'Deutsch Vokabular',
        album: 'Shadowing',
        artwork: [
          { src: new URL('icons/icon-192.png', document.baseURI).href, sizes: '192x192', type: 'image/png' },
          { src: new URL('icons/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' },
        ],
      });
    } catch { /* ignore */ }
  }

  private mediaState() {
    if (!this.media) return;
    try { this.media.playbackState = this.status === 'playing' ? 'playing' : this.status === 'finished' ? 'none' : 'paused'; } catch { /* ignore */ }
    this.position();
  }

  private position() {
    this.metadata();
    const m = this.media;
    if (!m?.setPositionState || !(this.session.duration > 0)) return;
    try {
      m.setPositionState({ duration: this.session.duration, playbackRate: 1, position: Math.min(this.session.duration, Math.max(0, this.audio.currentTime)) });
    } catch { /* ignore */ }
  }

  // ── snapshot ─────────────────────────────────────────────────────────────

  private emit() {
    if (this.disposed) return;
    this.snapshot = this.build();
    for (const l of [...this.listeners]) l();
  }

  private build(): PlayerSnapshot {
    const item = this.session.items[this.index];
    const timed = item?.steps[this.stepIndex];
    const step = this.status === 'finished' ? null : timed?.step ?? null;
    const isPause = step?.kind === 'pause' && timed !== undefined;
    return {
      status: this.status,
      index: this.index,
      total: this.session.items.length,
      stepIndex: this.stepIndex,
      steps: item?.steps.map((s) => s.step) ?? [],
      step,
      speaking: this.status === 'playing' && step?.kind === 'speak',
      pauseMs: isPause ? Math.round((timed.end - timed.start) * 1000) : null,
      pauseElapsedMs: isPause ? Math.max(0, Math.round((this.audio.currentTime - timed.start) * 1000)) : 0,
      completedIds: this.completed,
      notice: this.notice,
      wakeLock: 'unsupported',
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      endedEarly: this.endedEarly,
    };
  }
}
