import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** navigator.onLine (true where unknown). "Online" only means a network exists, not that Google is reachable. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => (typeof navigator === 'undefined' ? true : navigator.onLine), () => true);
}

/** Shown while the browser reports no network. All content is bundled, so browsing keeps working. */
export function OfflineBanner({ signedIn }: { signedIn: boolean }) {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status" lang="fa" dir="rtl" data-testid="offline-banner">
      <span aria-hidden="true">📴</span>{' '}
      {signedIn
        ? 'آفلاین هستید. واژه‌ها و تمرین‌ها در دسترس‌اند؛ تغییرات روی این دستگاه نگه داشته و پس از اتصال همگام می‌شوند.'
        : 'آفلاین هستید. واژه‌ها و تمرین‌ها در دسترس‌اند؛ ورود به حساب به اینترنت نیاز دارد.'}
    </div>
  );
}
