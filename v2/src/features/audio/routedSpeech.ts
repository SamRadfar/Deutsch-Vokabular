// Chooses, per utterance, between browser speech (Web Speech API) and the on-device voice played as
// media. The choice is real routing, not a retry loop:
//  - preference 'browser' / 'device' is honoured ('device' needs the downloaded voice);
//  - 'auto' (default) uses the on-device voice on iPhone/iPad when it is downloaded — there, browser
//    speech can be silenced by the silent switch without any error the page could notice;
//  - when browser speech reports a failure (never started, engine error), the same text is played
//    once with the on-device voice if it is available.

import { isUserCancel, type SpeakOptions, type SpeechService } from '../pronunciation/speechService';
import { preferPlaybackAudioSession } from './mediaOutput';

export type VoicePreference = 'auto' | 'browser' | 'device';
export type VoiceRoute = 'browser' | 'device';

export interface RoutedSpeechService extends SpeechService {
  readonly browser: SpeechService;
  readonly device: SpeechService;
  /** The engine the next utterance will use. */
  route(): VoiceRoute;
}

export function isAppleMobile(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined =
  typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

export function chooseRoute(pref: VoicePreference, deviceReady: boolean, appleMobile: boolean, browserSupported: boolean): VoiceRoute {
  if (!deviceReady) return 'browser';
  if (pref === 'device') return 'device';
  if (pref === 'browser') return browserSupported ? 'browser' : 'device';
  return appleMobile || !browserSupported ? 'device' : 'browser';
}

export interface RouterOptions {
  browser: SpeechService;
  device: SpeechService;
  preference: () => VoicePreference;
  deviceReady: () => boolean;
  appleMobile?: boolean;
}

export function createRoutedSpeech({ browser, device, preference, deviceReady, appleMobile = isAppleMobile() }: RouterOptions): RoutedSpeechService {
  const route = () => chooseRoute(preference(), deviceReady(), appleMobile, browser.supported);

  const speak = (text: string, opts: SpeakOptions = {}) => {
    if (route() === 'device') { device.speak(text, opts); return; }
    const fallback = deviceReady() && preference() !== 'browser';
    if (fallback) device.unlock(); // keep the media element usable if the fallback is needed later
    if (appleMobile) preferPlaybackAudioSession();
    let switched = false;
    browser.speak(text, {
      ...opts,
      onError: (code) => {
        if (fallback && !isUserCancel(code) && code !== 'not-allowed') {
          switched = true;
          device.speak(text, opts);
          return;
        }
        opts.onError?.(code);
      },
      onEnd: () => { if (!switched) opts.onEnd?.(); },
    });
  };

  return {
    get supported() { return browser.supported || deviceReady(); },
    browser,
    device,
    route,
    speak,
    cancel() { browser.cancel(); device.cancel(); },
    unlock() {
      if (route() === 'device' || deviceReady()) device.unlock();
      if (route() === 'browser') browser.unlock();
    },
    germanVoice: () => (route() === 'device' ? 'available' : browser.germanVoice()),
    voiceInfo: () => (route() === 'device' ? device.voiceInfo() : browser.voiceInfo()),
    whenVoicesReady: (ms) => (route() === 'device' ? Promise.resolve() : browser.whenVoicesReady(ms)),
    onVoicesChanged: (l) => browser.onVoicesChanged(l),
  };
}
