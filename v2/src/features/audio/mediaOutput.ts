// One shared HTMLAudioElement for short pronunciation clips and audio tests.
//
// Why media instead of speech on iPhone: Safari treats an <audio> element as media playback (heard
// with the ring/silent switch on, routed like music to speaker / headphones / Bluetooth), whereas
// Web Speech output can be silenced by the silent switch with no error the page could detect.
//
// iOS only lets an element start playing from a user gesture. unlock() plays a few milliseconds of
// silence on the shared element synchronously inside the tap; afterwards the same element may start
// playback programmatically (e.g. after a clip was synthesized, or the next shadowing step).

import { silentWav } from '../shadowing/audioSession/render';

export interface PlayHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  /** 'not-allowed' (autoplay policy), 'media-error' (decode / output), 'interrupted' (replaced / stopped). */
  onError?: (code: string) => void;
}

export interface MediaOutput {
  /** Synchronously inside a user gesture (no-op once unlocked). */
  unlock(): void;
  /** Plays `blob`; ends any clip that is playing ("interrupted"). */
  play(blob: Blob, handlers?: PlayHandlers): void;
  stop(): void;
}

interface AudioEl {
  src: string;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, l: () => void): void;
}

/** Safari 17+: play as media (heard with the silent switch on), not as ambient sound. */
export function preferPlaybackAudioSession() {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
  } catch { /* not supported */ }
}

export function createMediaOutput(make: () => AudioEl = () => new Audio() as unknown as AudioEl, urls = {
  create: (b: Blob) => URL.createObjectURL(b),
  revoke: (u: string) => URL.revokeObjectURL(u),
}): MediaOutput {
  let el: AudioEl | null = null;
  let unlocked = false;
  let url: string | null = null;
  let current: (PlayHandlers & { started: boolean; done: boolean }) | null = null;

  const element = () => {
    if (el) return el;
    const a = make();
    a.preload = 'auto';
    a.addEventListener('playing', () => {
      if (current && !current.started && !current.done) { current.started = true; current.onStart?.(); }
    });
    a.addEventListener('ended', () => finish(null));
    a.addEventListener('error', () => { if (current && !current.done) finish('media-error'); });
    el = a;
    return a;
  };

  const finish = (error: string | null) => {
    const c = current;
    if (!c || c.done) return;
    c.done = true;
    current = null;
    if (error) c.onError?.(error);
    c.onEnd?.();
  };

  const setSrc = (blob: Blob) => {
    if (url) urls.revoke(url);
    url = urls.create(blob);
    element().src = url;
  };

  return {
    unlock() {
      if (unlocked) return;
      const a = element();
      preferPlaybackAudioSession();
      if (!current) setSrc(silentWav(60));
      a.play().then(() => { unlocked = true; }, () => { /* the next tap tries again */ });
    },
    play(blob, handlers = {}) {
      finish('interrupted');
      const a = element();
      preferPlaybackAudioSession();
      const c = { ...handlers, started: false, done: false };
      current = c;
      setSrc(blob);
      a.play().then(
        () => { unlocked = true; },
        (e: unknown) => {
          if (current !== c) return;
          finish((e as { name?: string })?.name === 'NotAllowedError' ? 'not-allowed' : 'media-error');
        },
      );
    },
    stop() {
      el?.pause();
      finish('interrupted');
    },
  };
}

let shared: MediaOutput | null = null;
export function sharedMediaOutput(): MediaOutput {
  shared ??= createMediaOutput();
  return shared;
}
