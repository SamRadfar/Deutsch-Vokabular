import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Timers } from '../shadowing/player';
import { mirrorRootAttributes, openPipWindow, pipSupported, type PipHost } from './documentPip';

export type FloatingState =
  | { kind: 'closed' }
  /** A real Document Picture-in-Picture window (always on top). */
  | { kind: 'pip'; win: Window; container: HTMLElement }
  /** Browsers without Document PiP: a compact card inside this page (NOT always on top). */
  | { kind: 'inpage'; reason: 'unsupported' | 'refused' };

export const FLOATING_SIZE = { width: 340, height: 420 } as const;

/**
 * Timers that run in whichever window is visible. Chrome throttles timers of a minimized window
 * (down to once a minute after a while); the floating window stays visible, so while it is open
 * the shadowing pauses are timed there. Pending timers move when the window opens or closes.
 */
export class MovableTimers implements Timers {
  private readonly pending = new Map<object, { fn: () => void; due: number; w: Window; id: number }>();
  constructor(private readonly target: () => Window, private readonly now: () => number = Date.now) {}

  setTimeout(fn: () => void, ms: number): unknown {
    const token = {};
    this.schedule(token, fn, this.now() + Math.max(0, ms));
    return token;
  }

  clearTimeout(token: unknown): void {
    const p = this.pending.get(token as object);
    if (!p) return;
    try { p.w.clearTimeout(p.id); } catch { /* window already closed */ }
    this.pending.delete(token as object);
  }

  /** Re-schedules every pending timer in the current target window (keeps the due times). */
  rehome(): void {
    for (const [token, p] of [...this.pending]) {
      try { p.w.clearTimeout(p.id); } catch { /* closed */ }
      this.schedule(token, p.fn, p.due);
    }
  }

  private schedule(token: object, fn: () => void, due: number) {
    const w = this.target();
    const id = w.setTimeout(() => {
      if (this.pending.get(token)?.id !== id) return;
      this.pending.delete(token);
      fn();
    }, Math.max(0, due - this.now()));
    this.pending.set(token, { fn, due, w, id });
  }
}

/**
 * The one floating window of the page and the feature that holds it. Opening it for another
 * feature first closes the current holder's window (its card returns into the page); the active
 * session of that feature is not touched.
 */
let holder: { owner: string; close: () => void } | null = null;

export interface FloatingWindowOptions {
  /** Feature id ("shadowing", "review"). */
  owner: string;
  /** Title of the floating window. */
  title: string;
  /** Class of the React portal container inside the window. */
  rootClass?: string;
}

const SHADOWING: FloatingWindowOptions = { owner: 'shadowing', title: 'Deutsch Vokabular · Shadowing', rootClass: 'sh-float-root' };

export interface FloatingPlayer {
  state: FloatingState;
  supported: boolean;
  /** Call from the click handler (user activation is required). */
  open(): void;
  close(): void;
  /** Timers for a session player (follow the floating window). */
  timers: MovableTimers;
}

/** Shadowing's floating player (kept for its callers). */
export function useFloatingPlayer(host: PipHost = window as unknown as PipHost): FloatingPlayer {
  return useFloatingWindow(SHADOWING, host);
}

export function useFloatingWindow(options: FloatingWindowOptions, host: PipHost = window as unknown as PipHost): FloatingPlayer {
  const { owner, title, rootClass = 'sh-float-root' } = options;
  const supported = pipSupported(host);
  const [state, setState] = useState<FloatingState>({ kind: 'closed' });
  const winRef = useRef<Window | null>(null);
  const opening = useRef(false);
  const timers = useMemo(() => new MovableTimers(() => winRef.current ?? window), []);

  const close = useCallback(() => {
    const w = winRef.current;
    winRef.current = null;
    if (holder?.owner === owner) holder = null;
    timers.rehome();
    try { w?.close(); } catch { /* already closed */ }
    setState({ kind: 'closed' });
  }, [timers, owner]);

  const open = useCallback(() => {
    // One floating window per page: another feature's window closes first.
    if (holder && holder.owner !== owner) holder.close();
    holder = { owner, close };
    if (!supported) { setState({ kind: 'inpage', reason: 'unsupported' }); return; }
    if (winRef.current || opening.current) return; // never a second window
    opening.current = true;
    openPipWindow(FLOATING_SIZE, host, document, { owner, title }).then((win) => {
      opening.current = false;
      if (winRef.current === win) return;
      if (holder?.owner !== owner) { try { win.close(); } catch { /* closed */ } return; } // replaced meanwhile
      winRef.current = win;
      const container = win.document.createElement('div');
      container.className = rootClass;
      win.document.body.append(container);
      const unmirror = mirrorRootAttributes(document, win.document);
      win.addEventListener('pagehide', () => {
        unmirror();
        if (winRef.current !== win) return;
        winRef.current = null;
        if (holder?.owner === owner) holder = null;
        timers.rehome(); // pauses continue in the main window
        setState({ kind: 'closed' });
      }, { once: true });
      timers.rehome();
      setState({ kind: 'pip', win, container });
    }, () => {
      opening.current = false;
      setState({ kind: 'inpage', reason: 'refused' });
    });
  }, [supported, host, timers, owner, title, rootClass, close]);

  // Leaving the session (end, sign-out, account switch, unmount) closes the window, so no
  // vocabulary stays visible on the desktop.
  useEffect(() => () => {
    try { winRef.current?.close(); } catch { /* closed */ }
    winRef.current = null;
    if (holder?.owner === owner) holder = null;
  }, [owner]);

  return { state, supported, open, close, timers };
}
