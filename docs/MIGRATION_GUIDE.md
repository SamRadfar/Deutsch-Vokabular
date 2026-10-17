# Moving progress from the legacy app to Deutsch Vokabular 2.0

Audience: users of the legacy app and the product owner.
Technical rules: `docs/MIGRATION_SPEC.md`.

## What is moved

| Data | Moved? |
|---|---|
| Ticks «یادگرفتم» (`dvok6`, and old `dvok5` if there are no newer ticks) | **Yes**, *added* to your account |
| Ticks for words that no longer exist (e.g. 39 removed Bautechnik words) | No; listed in the preview |
| Custom words | Yes, since Phase 5A, separately: «واژه‌های من» → «انتقال از نسخهٔ قدیمی» (preview first, idempotent, see `PERSONAL_VOCABULARY.md` §6) |
| Pronunciation settings, exposure counters | Not in this version; they stay in the legacy app |
| Anthropic API key, sync code | **Never** |

Nothing in the legacy app is changed or deleted. A word that your account already marks as
*not learned* is never overwritten; it is listed as a conflict.

## Why a file is sometimes needed

Browser storage belongs to one web address (origin). The new app can read the legacy data
directly only when it runs on the **same address** as the legacy app (`https://samradfar.github.io`).
On any other address (for example `http://localhost:5173` during development) it cannot. In that
case, export a backup file from the legacy app and select it in the new app.

## Steps (same address)

1. Open the new app and sign in with Google.
2. Account menu → **«انتقال پیشرفت از نسخهٔ قدیمی…»** → «بررسی داده‌های این مرورگر».
3. Read the preview: number to import, already learned, conflicts, words that no longer exist.
4. Optionally «دانلود پشتیبان (JSON…)» to keep a copy.
5. Tick the confirmation and click «وارد کردن …».
6. Wait for «انتقال کامل شد». The same data cannot be imported twice into one account.

## Exporting a backup file from the legacy app (different address)

Do this on the device and browser where you used the legacy app.

1. Open `https://samradfar.github.io/Deutsch-Vokabular/`.
2. Open the browser's developer console (desktop Chrome/Edge/Firefox: `F12` → *Console*).
3. Paste the following snippet and press Enter. It **reads** your progress keys and downloads
   `deutsch-vokabular-legacy-backup.json`. It does not read the API key or the sync code and
   changes nothing.

```js
(() => {
  const keys = ['dvok6', 'dvok5', 'dvok5_custom', 'dvok5_pron_settings', 'dvok5_pron_exposure', 'dvok5_pron_selected_tabs', 'dvok_theme'];
  const backup = { format: 'deutsch-vokabular/legacy-backup', version: 1, createdAt: new Date().toISOString(), source: 'console-export', keys: {} };
  for (const k of keys) backup.keys[k] = localStorage.getItem(k);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  a.download = 'deutsch-vokabular-legacy-backup.json';
  a.click();
})();
```

4. In the new app: account menu → «انتقال پیشرفت از نسخهٔ قدیمی…» → «انتخاب فایل پشتیبان (JSON)».

> Security note: only paste code into the developer console when it comes from a source you
> trust, such as this repository. The snippet above is the exact format the app expects. If a
> file contains an API key or sync code anyway, the app ignores those values and says so.

On phones there is usually no console. Export on a desktop where the same progress exists
(e.g. after the legacy sync), or wait until v2 is served from the same address (Phase 4), where
no file is needed.
