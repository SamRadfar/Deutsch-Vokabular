import { RefreshCw } from 'lucide-react';
import { activateUpdate, useUpdateAvailable } from './serviceWorker';

/** Shown when a newer release has been downloaded by the service worker. */
export function UpdateNotice() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="update-notice" role="status" lang="fa" dir="rtl" data-testid="update-notice">
      <RefreshCw aria-hidden="true" />
      <span>نسخهٔ تازه‌ای از برنامه آماده است.</span>
      <button type="button" className="btn btn--primary btn--sm" onClick={activateUpdate}>به‌روزرسانی</button>
    </div>
  );
}
