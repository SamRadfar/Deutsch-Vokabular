// Screen Wake Lock (keeps the display on during a session). Available in Chromium browsers and
// Safari 16.4+; elsewhere the session simply runs without it. The browser releases the lock by
// itself when the page is hidden.

export interface WakeLockHandle {
  release(): void;
}

export interface WakeLockPort {
  readonly supported: boolean;
  /** Resolves with a handle, or null when the request was refused (e.g. battery saver). */
  request(onReleased: () => void): Promise<WakeLockHandle | null>;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', l: () => void): void }> };
}

export function createWakeLockPort(nav: WakeLockNavigator | undefined = typeof navigator === 'undefined' ? undefined : (navigator as WakeLockNavigator)): WakeLockPort {
  const api = nav?.wakeLock;
  if (!api) return { supported: false, request: async () => null };
  return {
    supported: true,
    async request(onReleased) {
      try {
        const sentinel = await api.request('screen');
        sentinel.addEventListener('release', onReleased);
        return { release: () => { sentinel.release().catch(() => {}); } };
      } catch {
        return null;
      }
    },
  };
}
