import { useProgress } from '../progress/ProgressProvider';
import { syncErrorText } from '../progress/syncEngine';
import type { SyncStatus } from '../progress/model';

export type SyncLabel = { tone: 'ok' | 'busy' | 'warn' | 'error'; text: string; detail?: string };

/** Single source for the user-facing sync wording (Persian). Never claims "saved" before server confirmation. */
export function describeSync(status: SyncStatus): SyncLabel {
  if (status.phase === 'loading') return { tone: 'busy', text: 'در حال بارگذاری پیشرفت…' };
  if (status.failedCount > 0) return { tone: 'error', text: 'خطا در همگام‌سازی', detail: `${status.failedCount} تغییر ذخیره نشد. ${status.lastError ? syncErrorText(status.lastError) : ''}` };
  if (status.remote === 'error' && status.lastError) return { tone: 'error', text: 'خطا در همگام‌سازی', detail: syncErrorText(status.lastError) };
  if (status.pendingCount > 0 && !status.online) return { tone: 'warn', text: `آفلاین — ${status.pendingCount} تغییر در انتظار`, detail: 'تغییرات روی این دستگاه نگه داشته می‌شوند و پس از اتصال ارسال می‌شوند.' };
  if (status.pendingCount > 0) return { tone: 'busy', text: status.writing ? 'در حال ذخیره…' : 'در حال همگام‌سازی…' };
  if (!status.online) return { tone: 'warn', text: 'آفلاین', detail: 'تغییرات جدید پس از اتصال ارسال می‌شوند.' };
  if (status.remote === 'connecting') return { tone: 'busy', text: 'در حال اتصال…' };
  if (!status.localPersistence) return { tone: 'warn', text: 'ذخیره شد (بدون حافظهٔ محلی)', detail: 'مرورگر ذخیره‌سازی محلی را مسدود کرده است؛ تغییرات آفلاین با بستن صفحه از بین می‌روند.' };
  return { tone: 'ok', text: 'ذخیره شد' };
}

export function SyncStatusIndicator() {
  const progress = useProgress();
  if (progress.status === 'unavailable') return null;
  const label = progress.status === 'loading'
    ? { tone: 'busy' as const, text: 'در حال بارگذاری پیشرفت…' }
    : describeSync(progress.view.status);
  return (
    <span className={`sync-pill sync-pill--${label.tone}`} role="status" aria-live="polite" lang="fa" dir="rtl" title={label.detail ?? label.text} data-testid="sync-status">
      <span className="sync-pill__dot" aria-hidden="true" />
      <span className="sync-pill__text">{label.text}</span>
    </span>
  );
}
