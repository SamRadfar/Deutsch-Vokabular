import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// The full suite runs many jsdom files in parallel (slow on Windows); give async UI
// assertions (session restore, progress loading) more headroom than the 1 s default.
configure({
  asyncUtilTimeout: 5000,
  // A failing *ByRole query lists every role of the page in its error message. In jsdom that costs
  // ~5 s for one category table (getComputedStyle per cell), and waitFor() calls the query again and
  // again while it waits — so a single retry could use up the whole timeout. Testing Library turns
  // these diagnostics off inside waitFor only for Jest fake timers; we turn them off for all runs.
  // Errors still contain the message and the DOM.
  _disableExpensiveErrorDiagnostics: true,
} as Parameters<typeof configure>[0]);

// Worker tests run in the node environment (`// @vitest-environment node`) — no DOM there.
const hasDom = typeof window !== 'undefined';

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', window.location.pathname); // the hash is the section route
  document.documentElement.removeAttribute('data-theme');
});

// jsdom implements neither matchMedia nor speechSynthesis; tests opt in per case.
if (hasDom && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
