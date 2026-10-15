import { useAuth } from '../auth/AuthProvider';

/** Persian sign-in / sign-out error under the header; info (cancelled) vs. error severity. */
export function AuthErrorBanner() {
  const { error, dismissError } = useAuth();
  if (!error) return null;
  return (
    <div className={`auth-banner auth-banner--${error.severity}`} role={error.severity === 'error' ? 'alert' : 'status'} lang="fa" dir="rtl">
      <span>{error.message}</span>
      <button type="button" className="auth-banner__close" onClick={dismissError} aria-label="بستن پیام">×</button>
    </div>
  );
}
