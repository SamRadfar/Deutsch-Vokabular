import './welcome.css';
import { useEffect, type ReactNode } from 'react';
import { AudioLines, Layers, LoaderCircle, LogIn, RefreshCw, Star, TriangleAlert, WifiOff } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { AuthErrorBanner } from '../account/AuthErrorBanner';
import type { LibraryState } from './libraryService';

const FEATURES = [
  { icon: Layers, title: 'فلش‌کارت و مرور دوباره', text: 'واژه‌ها را بسنج و ناآشناها را دوباره مرور کن.' },
  { icon: AudioLines, title: 'تمرین تلفظ', text: 'آلمانی را بشنو و در مکث بلند تکرار کن.' },
  { icon: Star, title: 'واژه‌نامهٔ شخصی', text: 'واژه‌های خودت را بساز؛ روی همهٔ دستگاه‌هایت همگام.' },
];

const LIBRARY_TEXT: Record<'offline' | 'invalid' | 'denied' | 'unknown', string> = {
  offline: 'برای بار اول بارگذاری کتابخانهٔ شما به اینترنت نیاز است. پس از آن روی همین دستگاه آفلاین هم کار می‌کند.',
  invalid: 'کتابخانهٔ شما بررسی شد ولی معتبر نبود و نمایش داده نشد. لطفاً دوباره تلاش کنید.',
  denied: 'دسترسی به کتابخانهٔ این حساب مجاز نیست.',
  unknown: 'کتابخانهٔ شما هنوز بارگذاری نشده است. اتصال را بررسی کنید و دوباره تلاش کنید.',
};

/**
 * Signed-out welcome (no vocabulary is shown or loaded) and the short states while the signed-in
 * account's library loads.
 */
export function Welcome({ extras, library, onRetry }: { extras?: ReactNode; library?: LibraryState; onRetry?(): void }) {
  const { state, signIn, cancelSignIn } = useAuth();
  const signedIn = state.status === 'signed-in' || state.status === 'signing-out';
  useEffect(() => { document.title = 'Deutsch Vokabular · واژه‌نامهٔ تخصصی آلمانی'; }, []);

  let action: ReactNode;
  if (signedIn) {
    action = library?.status === 'error' ? (
      <div className="welcome__state" role="alert">
        {library.reason === 'offline' ? <WifiOff /> : <TriangleAlert />}
        <p>{LIBRARY_TEXT[library.reason]}</p>
        <button type="button" className="btn" onClick={onRetry}><RefreshCw />تلاش دوباره</button>
      </div>
    ) : (
      <p className="welcome__state" role="status"><LoaderCircle className="spin" />در حال بارگذاری کتابخانهٔ شما…</p>
    );
  } else if (state.status === 'unavailable') {
    action = <p className="welcome__state" role="note">ورود در این نسخه پیکربندی نشده است.</p>;
  } else if (state.status === 'initializing') {
    action = <p className="welcome__state" role="status" aria-label="در حال بررسی وضعیت ورود…"><LoaderCircle className="spin" /></p>;
  } else if (state.status === 'signing-in') {
    action = (
      <div className="welcome__actions">
        <span className="btn btn--primary btn--lg" role="status" aria-live="polite"><LoaderCircle className="spin" />در حال ورود…</span>
        <button type="button" className="btn btn--lg" onClick={cancelSignIn}>لغو</button>
      </div>
    );
  } else {
    action = (
      <div className="welcome__actions">
        <button type="button" className="btn btn--primary btn--lg welcome__signin" onClick={() => void signIn()}><LogIn />ورود با گوگل</button>
      </div>
    );
  }

  return (
    <div className="welcome" lang="fa" dir="rtl" data-testid="welcome">
      <div className="frame" aria-hidden="true" />
      <div className="welcome__top">{extras}</div>
      <main className="welcome__main" id="main" tabIndex={-1}>
        <img className="welcome__logo" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={88} height={88} />
        <p className="page-head__eyebrow"><span>واژه‌نامهٔ تخصصی آلمانی–فارسی</span><span>B2 / C1</span></p>
        <h1 className="welcome__title"><span lang="de" dir="ltr">Deutsch Vokabular</span></h1>
        <p className="welcome__sub">
          {signedIn ? 'خوش آمدید!' : 'برای دیدن و تمرین واژه‌های خود وارد حساب گوگل شوید. هر حساب کتابخانهٔ جداگانهٔ خودش را دارد.'}
        </p>
        <AuthErrorBanner />
        {action}
        {!signedIn ? (
          <ul className="welcome__features">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title}><span className="welcome__ficon"><Icon /></span><strong>{title}</strong><span>{text}</span></li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  );
}
