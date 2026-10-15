import type { AuthError } from './types';

const CANCELLED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

const MESSAGES: Record<string, string> = {
  'auth/popup-blocked':
    'مرورگر پنجرهٔ ورود را مسدود کرد. اجازهٔ باز شدن پنجره (pop-up) را برای این سایت بدهید و دوباره روی «ورود با گوگل» بزنید.',
  'auth/network-request-failed':
    'اتصال به سرویس ورود گوگل برقرار نشد. اتصال اینترنت را بررسی کنید؛ اگر سرویس‌های گوگل در شبکهٔ شما مسدود است، به VPN نیاز دارید.',
  'auth/unauthorized-domain':
    'این نشانی (دامنه) در تنظیمات Firebase مجاز نشده است. مدیر برنامه باید آن را در Authorized domains اضافه کند.',
  'auth/operation-not-allowed': 'ورود با گوگل در پروژهٔ Firebase فعال نشده است.',
  'auth/configuration-not-found': 'ورود با گوگل در پروژهٔ Firebase فعال نشده است.',
  'auth/invalid-api-key': 'پیکربندی Firebase نامعتبر است (API key).',
  'auth/operation-not-supported-in-this-environment':
    'این مرورگر از ورود با پنجرهٔ جداگانه پشتیبانی نمی‌کند (مثلاً مرورگر داخلی تلگرام یا اینستاگرام). سایت را در Chrome، Safari یا Firefox باز کنید.',
  'auth/web-storage-unsupported':
    'ذخیره‌سازی مرورگر غیرفعال است (مثلاً حالت خصوصی سخت‌گیرانه). برای ورود، ذخیره‌سازی سایت را مجاز کنید.',
  'auth/too-many-requests': 'تعداد تلاش‌ها زیاد بود. کمی صبر کنید و دوباره امتحان کنید.',
  'auth/user-disabled': 'این حساب غیرفعال شده است.',
  'auth/account-exists-with-different-credential': 'این ایمیل قبلاً با روش ورود دیگری ثبت شده است.',
  'auth/internal-error': 'ورود به‌دلیل خطای داخلی ناموفق بود. دوباره امتحان کنید.',
};

export function toAuthError(error: unknown): AuthError {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'auth/unknown';
  if (CANCELLED.has(code)) return { code, message: 'ورود لغو شد.', severity: 'info' };
  return { code, message: MESSAGES[code] ?? 'ورود ناموفق بود. لطفاً دوباره امتحان کنید.', severity: 'error' };
}

export const SIGN_OUT_FAILED: AuthError = {
  code: 'app/sign-out-failed',
  message: 'خروج از حساب ناموفق بود. دوباره امتحان کنید.',
  severity: 'error',
};
