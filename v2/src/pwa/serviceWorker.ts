// Service-worker registration (production builds only) and the "new version available" state.
// The worker (scripts/sw.template.js) loads index.html network-first, so a reload always gets the
// newest release; this module additionally offers to switch an open page to it right away.

import { useSyncExternalStore } from 'react';

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** Register /sw.js and watch for updates. Never throws: the app works without a service worker. */
export function registerServiceWorker(url = '/sw.js'): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return; // first install: no reload needed
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    sw.register(url, { scope: '/' }).then((reg) => {
      const track = (worker: ServiceWorker | null) => {
        worker?.addEventListener('statechange', () => {
          // "installed" while a page is controlled = an update is ready (not the first install).
          if (worker.state === 'installed' && sw.controller) { waiting = worker; emit(); }
        });
      };
      if (reg.waiting && sw.controller) { waiting = reg.waiting; emit(); }
      reg.addEventListener('updatefound', () => track(reg.installing));
      // Look for a new release when the user comes back to the tab, and hourly.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => {}); });
      setInterval(() => { void reg.update().catch(() => {}); }, 60 * 60 * 1000);
    }).catch(() => { /* e.g. private mode: continue without offline support */ });
  });
}

/** Activate the waiting release; the page reloads once it controls the page. */
export function activateUpdate(): void {
  waiting?.postMessage('dv2:activate');
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => waiting !== null,
    () => false,
  );
}
