/** "4 ثانیه", "2.5 ثانیه" */
export const formatSeconds = (sec: number) => `${Number.isInteger(sec) ? sec : sec.toFixed(1)} ثانیه`;

/** m:ss (or h:mm:ss) for durations shown with dir="ltr". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
