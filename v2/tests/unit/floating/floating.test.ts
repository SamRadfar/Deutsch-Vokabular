// Floating player: timers follow the visible window (a minimized main window is throttled by the
// browser; the Picture-in-Picture window is not), and the window helpers copy styles and theme.
import { describe, expect, it, vi } from 'vitest';
import { copyStyles, mirrorRootAttributes, openPipWindow, pipOwner, pipSupported } from '../../../src/features/floating/documentPip';
import { MovableTimers } from '../../../src/features/floating/useFloatingWindow';

function fakeWindow() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    pending,
    setTimeout: vi.fn((fn: () => void) => { const id = next++; pending.set(id, fn); return id; }),
    clearTimeout: vi.fn((id: number) => { pending.delete(id); }),
    fire() { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); },
  };
}

describe('MovableTimers', () => {
  it('schedules in the current window and moves pending timers (same due time) when the window changes', () => {
    const main = fakeWindow();
    const pip = fakeWindow();
    let target: typeof main = main;
    let now = 1000;
    const t = new MovableTimers(() => target as unknown as Window, () => now);
    const fn = vi.fn();
    t.setTimeout(fn, 3000);
    expect(main.setTimeout).toHaveBeenCalledWith(expect.any(Function), 3000);

    now = 2000; // 1 s later the floating window opens
    target = pip;
    t.rehome();
    expect(main.pending.size).toBe(0);
    expect(pip.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2000);
    pip.fire();
    expect(fn).toHaveBeenCalledOnce();

    // closing the floating window brings pending timers back to the main window
    const g = vi.fn();
    t.setTimeout(g, 500);
    target = main;
    t.rehome();
    expect(pip.pending.size).toBe(0);
    main.fire();
    expect(g).toHaveBeenCalledOnce();
  });

  it('clearTimeout cancels wherever the timer currently lives', () => {
    const w = fakeWindow();
    const t = new MovableTimers(() => w as unknown as Window);
    const fn = vi.fn();
    const id = t.setTimeout(fn, 10);
    t.clearTimeout(id);
    w.fire();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('Document Picture-in-Picture helpers', () => {
  it('detects support', () => {
    expect(pipSupported({})).toBe(false);
    expect(pipSupported({ documentPictureInPicture: { requestWindow: async () => window, window: null } })).toBe(true);
  });

  it("reuses its own open window; another feature's window is replaced, never a second one", async () => {
    const pipDoc = () => document.implementation.createHTMLDocument('pip');
    const shadowWin = { document: pipDoc(), close: vi.fn() } as unknown as Window;
    const reviewWin = { document: pipDoc(), close: vi.fn() } as unknown as Window;
    const api = { window: null as Window | null, requestWindow: vi.fn() };
    api.requestWindow.mockImplementation(async () => (api.window = api.requestWindow.mock.calls.length === 1 ? shadowWin : reviewWin));
    const host = { documentPictureInPicture: api };
    await expect(openPipWindow({ width: 340, height: 420 }, host, document, { owner: 'shadowing', title: 'S' })).resolves.toBe(shadowWin);
    await expect(openPipWindow({ width: 340, height: 420 }, host, document, { owner: 'shadowing', title: 'S' })).resolves.toBe(shadowWin);
    expect(api.requestWindow).toHaveBeenCalledTimes(1);
    await expect(openPipWindow({ width: 340, height: 420 }, host, document, { owner: 'review', title: 'Deutsch Vokabular · مرور' })).resolves.toBe(reviewWin);
    expect(api.requestWindow).toHaveBeenCalledTimes(2);
    expect(reviewWin.document.title).toBe('Deutsch Vokabular · مرور');
    expect(pipOwner(reviewWin)).toBe('review');
  });

  it('copies stylesheets and mirrors the theme into the floating document', () => {
    const src = document.implementation.createHTMLDocument('src');
    const style = src.createElement('style');
    style.textContent = '.sh-float { color: red; }';
    src.head.append(style);
    src.documentElement.setAttribute('data-theme', 'dark');
    const dst = document.implementation.createHTMLDocument('pip');
    copyStyles(src, dst);
    expect(dst.head.querySelector('style')?.textContent).toContain('.sh-float');
    const stop = mirrorRootAttributes(src, dst);
    expect(dst.documentElement.getAttribute('data-theme')).toBe('dark');
    stop();
  });
});
