// Document Picture-in-Picture (Chrome / Edge 116+ on desktop): a real, separate, always-on-top
// browser window that stays visible when the main window is minimized or another application is
// in front. The window shares this page's JavaScript realm, so the floating card is rendered with a
// React portal from the running shadowing session — one session state, one audio pipeline.
//
// https://developer.chrome.com/docs/web-platform/document-picture-in-picture

export interface PipHost {
  documentPictureInPicture?: {
    requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
    readonly window: Window | null;
  };
}

export function pipSupported(host: PipHost = window as unknown as PipHost): boolean {
  return typeof host.documentPictureInPicture?.requestWindow === 'function';
}

/** Copies this page's stylesheets (same-origin links by absolute URL, inline styles by text). */
export function copyStyles(from: Document, to: Document) {
  for (const el of from.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')) {
    if (el.tagName === 'LINK') {
      const link = to.createElement('link');
      link.rel = 'stylesheet';
      link.href = (el as HTMLLinkElement).href; // absolute URL (the floating document is about:blank)
      to.head.append(link);
    } else if (el.textContent) {
      const style = to.createElement('style');
      style.textContent = el.textContent;
      to.head.append(style);
    }
  }
}

const MIRRORED = ['data-theme', 'lang', 'dir', 'class'] as const;

/** Keeps theme (light/dark) and language attributes of the floating document in sync. */
export function mirrorRootAttributes(from: Document, to: Document): () => void {
  const copy = () => {
    for (const name of MIRRORED) {
      const v = from.documentElement.getAttribute(name);
      if (v === null) to.documentElement.removeAttribute(name);
      else to.documentElement.setAttribute(name, v);
    }
  };
  copy();
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(copy);
  observer.observe(from.documentElement, { attributes: true, attributeFilter: [...MIRRORED] });
  return () => observer.disconnect();
}

/**
 * Opens the floating window (or returns the one already open — never two). Must be called from a
 * user click: the browser refuses Picture-in-Picture without user activation.
 */
export async function openPipWindow(size: { width: number; height: number }, host: PipHost = window as unknown as PipHost, doc: Document = document): Promise<Window> {
  const api = host.documentPictureInPicture;
  if (!api) throw new Error('Document Picture-in-Picture is not supported');
  if (api.window) return api.window;
  const win = await api.requestWindow({ width: size.width, height: size.height });
  win.document.title = 'Deutsch Vokabular · Shadowing';
  copyStyles(doc, win.document);
  win.document.body.classList.add('sh-float-doc');
  return win;
}
