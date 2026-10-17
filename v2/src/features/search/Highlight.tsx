import { memo } from 'react';
import type { Range } from './searchIndex';

/** Renders `text` with the given ranges wrapped in <mark>. Plain React text nodes — no HTML injection. */
export const Highlight = memo(function Highlight({ text, ranges }: { text: string; ranges?: readonly Range[] | undefined }) {
  if (!ranges?.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], i) => {
    if (s > pos) parts.push(text.slice(pos, s));
    parts.push(<mark key={i} className="hl">{text.slice(s, e)}</mark>);
    pos = e;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
});
