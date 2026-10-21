// SpeechService backed by the on-device voice: text → WAV (Piper in a worker) → shared <audio>.
// Used for pronunciation on iPhone (media playback is heard with the silent switch on) and as an
// automatic fallback when browser speech fails. Same contract as the browser speech service, so the
// buttons, flashcards and the live shadowing player work with either.

import type { SpeakOptions, SpeechService } from '../pronunciation/speechService';
import { renderClip } from '../shadowing/audioSession/render';
import type { MediaOutput } from './mediaOutput';
import { openNeuralVoice, type NeuralVoice } from './neuralVoice';
import { VOICES, type VoiceId } from './voiceAssets';

/** Keeps one voice worker alive while it is used; frees it after a quiet period. */
export function createVoiceHandle(open: () => Promise<NeuralVoice> = () => openNeuralVoice(), idleMs = 4 * 60_000) {
  let voice: Promise<NeuralVoice> | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const release = () => {
    const v = voice;
    voice = null;
    void v?.then((x) => x.dispose(), () => {});
  };
  return {
    get(): Promise<NeuralVoice> {
      if (idle) clearTimeout(idle);
      idle = setTimeout(release, idleMs);
      voice ??= open().catch((e: unknown) => { voice = null; throw e; });
      return voice;
    },
    release,
  };
}

export interface DeviceSpeechOptions {
  output: MediaOutput;
  voice: { get(): Promise<NeuralVoice> };
  /** Which voice the handle opens (for voice information; default German). */
  voiceId?: VoiceId;
  /** Clip cache size (texts); clips live in memory only. */
  cacheSize?: number;
}

export function createDeviceSpeechService({ output, voice, voiceId = 'de', cacheSize = 120 }: DeviceSpeechOptions): SpeechService {
  const cache = new Map<string, Blob>();
  let token = 0;
  let active: { id: number; finish: (error: string | null) => void } | null = null;

  /** In-flight syntheses, so a prefetched text is not synthesized twice. */
  const pending = new Map<string, Promise<Blob>>();
  /** Bumped by clearCache(): results of older syntheses are not cached (they may belong to another account). */
  let generation = 0;
  const clip = async (text: string, rate: number): Promise<Blob> => {
    const key = `${rate}|${text}`;
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
    const running = pending.get(key);
    if (running) return running;
    const g = generation;
    const job = (async () => {
      const { wav } = await renderClip(text, rate, await voice.get());
      if (g !== generation) return wav;
      cache.set(key, wav);
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
      return wav;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  };

  return {
    supported: true,
    speak(text, { rate = 0.85, onStart, onEnd, onError }: SpeakOptions = {}) {
      active?.finish('interrupted');
      output.unlock(); // inside the tap: later playback of this element is allowed (iOS)
      const id = ++token;
      let done = false;
      const finish = (error: string | null) => {
        if (done) return;
        done = true;
        if (active?.id === id) active = null;
        if (error) onError?.(error);
        onEnd?.();
      };
      active = { id, finish };
      clip(text, rate).then(
        (wav) => {
          if (done) return;
          output.play(wav, {
            onStart: () => { if (!done) onStart?.(); },
            onError: (code) => { if (code !== 'interrupted') finish(code); },
            onEnd: () => finish(null),
          });
        },
        () => finish('device-voice-failed'),
      );
    },
    cancel() {
      const a = active;
      active = null;
      a?.finish('canceled');
      output.stop();
    },
    unlock() { output.unlock(); },
    prefetch(texts, rate = 0.85) {
      // Synthesize ahead (in the worker), so the clip is ready when its turn comes; errors surface on speak().
      for (const t of texts) if (t.trim()) void clip(t, rate).catch(() => {});
    },
    clearCache() { generation++; cache.clear(); pending.clear(); },
    germanVoice: () => 'available',
    voiceInfo: () => {
      const c = VOICES[voiceId].config;
      const v = { name: c.name, lang: c.lang, local: true };
      return { total: 1, german: voiceId === 'de' ? [v] : [], selected: v };
    },
    whenVoicesReady: () => Promise.resolve(),
    onVoicesChanged: () => () => {},
  };
}
