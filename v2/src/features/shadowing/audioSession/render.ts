// Renders a whole shadowing session into ONE audio file: every word and example with its
// repetitions, and the learner pauses as real silence. A single continuous file is what lets the
// session keep playing with the screen locked — the browser just plays media; no JavaScript timer
// or speechSynthesis callback has to run in the background (they are suspended there).
//
// The audio exists only in memory (a Blob URL) for this session; nothing is uploaded or stored.

import type { WordId } from '../../../models/vocabulary';
import { pauseDuration, planItem, type Step } from '../plan';
import type { ShadowingSettings } from '../settings';
import type { ShadowingItem } from '../player';

export interface TimedStep {
  step: Step;
  /** Seconds from the start of the file. */
  start: number;
  end: number;
}

export interface TimedItem {
  id: WordId;
  start: number;
  end: number;
  steps: TimedStep[];
}

export interface RenderedSession {
  wav: Blob;
  /** Seconds. */
  duration: number;
  items: TimedItem[];
}

export interface Synthesizer {
  readonly sampleRate: number;
  synthesize(text: string, rate: number): Promise<Float32Array>;
}

export interface RenderOptions {
  /** (texts done, texts total) — synthesis is the slow part. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Silence before the first word (Bluetooth headsets swallow the first fraction of a second). */
  leadInMs?: number;
}

export class RenderAbortedError extends Error {
  constructor() { super('rendering cancelled'); this.name = 'RenderAbortedError'; }
}

/** Cuts leading/trailing near-silence, keeping a short natural margin. */
export function trimSilence(pcm: Float32Array, sampleRate: number, threshold = 0.004, marginMs = 60): Float32Array {
  let a = 0;
  let b = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]!) < threshold) a++;
  while (b > a && Math.abs(pcm[b]!) < threshold) b--;
  if (a >= b) return pcm;
  const m = Math.round((marginMs / 1000) * sampleRate);
  return pcm.subarray(Math.max(0, a - m), Math.min(pcm.length, b + m + 1));
}

/** Gain so the loudest sample reaches ~0.9 (Piper voices are quiet), at most ×3. */
function gainFor(pcm: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]!));
  return peak > 0 ? Math.min(3, 0.9 / peak) : 1;
}

export async function renderSession(
  items: readonly ShadowingItem[],
  settings: Pick<ShadowingSettings, 'wordRepeats' | 'exampleRepeats' | 'pauseSec' | 'rate'>,
  voice: Synthesizer,
  { onProgress, signal, leadInMs = 400 }: RenderOptions = {},
): Promise<RenderedSession> {
  const sr = voice.sampleRate;
  const plans = items.map((item) => planItem(item, settings));
  const texts = [...new Set(plans.flatMap((steps) => steps.flatMap((s) => (s.kind === 'speak' ? [s.text] : []))))];

  // 1. synthesize every distinct text once (repetitions reuse it)
  const clips = new Map<string, { pcm: Float32Array; gain: number }>();
  onProgress?.(0, texts.length);
  for (const text of texts) {
    if (signal?.aborted) throw new RenderAbortedError();
    const pcm = trimSilence(await voice.synthesize(text, settings.rate), sr);
    clips.set(text, { pcm, gain: gainFor(pcm) });
    onProgress?.(clips.size, texts.length);
  }
  if (signal?.aborted) throw new RenderAbortedError();

  // 2. lay out the timeline (sample positions)
  type Segment = { kind: 'clip'; clip: { pcm: Float32Array; gain: number } } | { kind: 'silence'; samples: number };
  const segments: Segment[] = [];
  let cursor = Math.round((leadInMs / 1000) * sr);
  segments.push({ kind: 'silence', samples: cursor });
  const timed: TimedItem[] = items.map((item, i) => {
    const itemStart = cursor;
    let lastSpeechMs = 0;
    const steps = plans[i]!.map((step): TimedStep => {
      const start = cursor;
      if (step.kind === 'speak') {
        const clip = clips.get(step.text)!;
        segments.push({ kind: 'clip', clip });
        cursor += clip.pcm.length;
        lastSpeechMs = (clip.pcm.length / sr) * 1000;
      } else {
        const samples = Math.round((pauseDuration(step, lastSpeechMs) / 1000) * sr);
        segments.push({ kind: 'silence', samples });
        cursor += samples;
      }
      return { step, start: start / sr, end: cursor / sr };
    });
    return { id: item.id, start: itemStart / sr, end: cursor / sr, steps };
  });

  // 3. one 16-bit mono WAV
  const total = cursor;
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  writeWavHeader(view, total, sr);
  const out = new Int16Array(buffer, 44, total);
  let at = 0;
  for (const seg of segments) {
    if (seg.kind === 'silence') { at += seg.samples; continue; } // ArrayBuffer is zero-filled
    const { pcm, gain } = seg.clip;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i]! * gain;
      out[at++] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
    }
  }
  return { wav: new Blob([buffer], { type: 'audio/wav' }), duration: total / sr, items: timed };
}

function writeWavHeader(view: DataView, samples: number, sampleRate: number) {
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
}

/** A short silent WAV (used to activate an audio element inside a user gesture). */
export function silentWav(ms = 50, sampleRate = 22_050): Blob {
  const samples = Math.round((ms / 1000) * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  writeWavHeader(new DataView(buffer), samples, sampleRate);
  return new Blob([buffer], { type: 'audio/wav' });
}

/** One spoken text as a short WAV (pronunciation buttons played as media, e.g. on iPhone). */
export async function renderClip(text: string, rate: number, voice: Synthesizer, leadInMs = 150): Promise<{ wav: Blob; duration: number }> {
  const sr = voice.sampleRate;
  const pcm = trimSilence(await voice.synthesize(text, rate), sr);
  const gain = gainFor(pcm);
  const lead = Math.round((leadInMs / 1000) * sr);
  const tail = Math.round(0.1 * sr);
  const total = lead + pcm.length + tail;
  const buffer = new ArrayBuffer(44 + total * 2);
  writeWavHeader(new DataView(buffer), total, sr);
  const out = new Int16Array(buffer, 44, total);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]! * gain;
    out[lead + i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
  return { wav: new Blob([buffer], { type: 'audio/wav' }), duration: total / sr };
}

/** A short audible test tone (no voice needed): tells "media output works" apart from "speech is muted". */
export function toneWav(ms = 600, hz = 660, sampleRate = 22_050): Blob {
  const samples = Math.round((ms / 1000) * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  writeWavHeader(new DataView(buffer), samples, sampleRate);
  const out = new Int16Array(buffer, 44, samples);
  const fade = Math.round(0.02 * sampleRate);
  for (let i = 0; i < samples; i++) {
    const env = Math.min(1, i / fade, (samples - i) / fade);
    out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.5 * env * 32767);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
