import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useProgress } from '../progress/ProgressProvider';
import { Dialog } from '../../components/Dialog/Dialog';
import { describeSync } from './SyncStatusIndicator';
import './account.css';

interface Props {
  totalEntries: number;
  learnedCount: number | null;
  onOpenMigration(): void;
}

/** Header authentication control: sign-in button, or the signed-in account menu. */
export function AccountControl({ totalEntries, learnedCount, onOpenMigration }: Props) {
  const { state, signIn, cancelSignIn } = useAuth();
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();

  switch (state.status) {
    case 'unavailable':
      return (
        <div className="auth-unavailable">
          <button type="button" className="auth-btn auth-btn--muted" aria-expanded={infoOpen} aria-controls={infoId} onClick={() => setInfoOpen((v) => !v)}>
            ورود با گوگل
          </button>
          {infoOpen ? (
            <div id={infoId} className="auth-popover" role="note" lang="fa" dir="rtl">
              ورود در این نسخه هنوز پیکربندی نشده است (Firebase). مرور واژه‌ها بدون ورود ممکن است؛ ذخیرهٔ پیشرفت پس از پیکربندی فعال می‌شود.
              {import.meta.env.DEV && state.details.length ? <code className="auth-popover__code">{state.details.join(', ')}</code> : null}
            </div>
          ) : null}
        </div>
      );
    case 'initializing':
      return <span className="auth-skeleton" role="status" aria-label="در حال بررسی وضعیت ورود…" />;
    case 'signed-out':
      return <button type="button" className="auth-btn" onClick={() => void signIn()} lang="fa">ورود با گوگل</button>;
    case 'signing-in':
      return (
        <span className="auth-signing" lang="fa" dir="rtl">
          <span className="auth-btn auth-btn--busy" role="status" aria-live="polite">در حال ورود…</span>
          <button type="button" className="auth-btn auth-btn--muted" onClick={cancelSignIn}>لغو</button>
        </span>
      );
    case 'signed-in':
    case 'signing-out':
      return <AccountMenu user={state.user} signingOut={state.status === 'signing-out'} totalEntries={totalEntries} learnedCount={learnedCount} onOpenMigration={onOpenMigration} />;
  }
}

function Avatar({ name, photoURL }: { name: string; photoURL: string | null }) {
  const [broken, setBroken] = useState(false);
  if (photoURL && !broken) {
    return <img className="avatar" src={photoURL} alt="" width={32} height={32} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="avatar avatar--initial" aria-hidden="true">{(name.trim()[0] ?? '?').toUpperCase()}</span>;
}

function AccountMenu({ user, signingOut, totalEntries, learnedCount, onOpenMigration }: {
  user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null };
  signingOut: boolean;
  totalEntries: number;
  learnedCount: number | null;
  onOpenMigration(): void;
}) {
  const { signOut } = useAuth();
  const progress = useProgress();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = user.displayName ?? user.email ?? 'حساب کاربری';
  const pending = progress.status === 'ready' ? progress.view.status.pendingCount : 0;
  const sync = progress.status === 'ready' ? describeSync(progress.view.status) : null;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const requestSignOut = () => {
    setOpen(false);
    if (pending > 0) setConfirmSignOut(true);
    else void signOut();
  };

  const waitThenSignOut = async () => {
    if (progress.status !== 'ready') return;
    setWaiting(true);
    progress.engine.flush();
    const done = await progress.engine.waitForSettled(undefined, 10_000);
    setWaiting(false);
    if (done) { setConfirmSignOut(false); void signOut(); }
  };

  return (
    <div className="account">
      <button
        ref={buttonRef}
        type="button"
        className="account__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`حساب کاربری: ${name}`}
        onClick={() => setOpen((v) => !v)}
        disabled={signingOut}
        data-testid="account-button"
      >
        <Avatar name={name} photoURL={user.photoURL} />
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} className="account__menu" role="menu" aria-label="حساب کاربری" onKeyDown={onMenuKey} lang="fa" dir="rtl">
          <div className="account__identity" role="presentation">
            <div className="account__name" dir="auto">{user.displayName ?? '—'}</div>
            {user.email ? <div className="account__email" dir="ltr">{user.email}</div> : null}
            {learnedCount !== null ? <div className="account__progress">{learnedCount} از {totalEntries} واژه یادگرفته</div> : null}
            {sync ? <div className={`account__sync account__sync--${sync.tone}`}>{sync.text}{sync.detail ? ` — ${sync.detail}` : ''}</div> : null}
          </div>
          <button type="button" role="menuitem" className="account__item" onClick={() => { setOpen(false); onOpenMigration(); }} disabled={progress.status !== 'ready'}>
            انتقال پیشرفت از نسخهٔ قدیمی…
          </button>
          {progress.status === 'ready' && progress.view.status.failedCount + (progress.view.status.remote === 'error' ? 1 : 0) > 0 ? (
            <button type="button" role="menuitem" className="account__item" onClick={() => { progress.engine.retryFailed(); close(); }}>
              تلاش دوباره برای همگام‌سازی
            </button>
          ) : null}
          <button type="button" role="menuitem" className="account__item account__item--danger" onClick={requestSignOut}>
            خروج از حساب
          </button>
        </div>
      ) : null}
      {confirmSignOut ? (
        <Dialog title="تغییرات همگام‌نشده" onClose={() => setConfirmSignOut(false)} busy={waiting}>
          <p>
            {pending} تغییر هنوز به سرور نرسیده است. اگر اکنون خارج شوید، این تغییرات <strong>پاک نمی‌شوند</strong>:
            روی همین دستگاه برای همین حساب نگه داشته می‌شوند و دفعهٔ بعد که با همین حساب وارد شوید ارسال می‌شوند.
            حساب دیگری به آن‌ها دسترسی ندارد.
          </p>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={() => void waitThenSignOut()} disabled={waiting}>
              {waiting ? 'در حال همگام‌سازی…' : 'اول همگام‌سازی، بعد خروج'}
            </button>
            <button type="button" className="btn" onClick={() => { setConfirmSignOut(false); void signOut(); }} disabled={waiting}>
              خروج و نگه‌داشتن روی این دستگاه
            </button>
            <button type="button" className="btn" onClick={() => setConfirmSignOut(false)} disabled={waiting}>انصراف</button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
