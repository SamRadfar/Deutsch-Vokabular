import { AudioLines, Lock } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { useOnDeviceVoice } from '../../audio/useOnDeviceVoice';
import { usePronunciation } from '../../pronunciation/PronunciationProvider';
import { modeAvailable, REVIEW_MODES, type DeckCard, type DeckProgress, type PracticeCategoryKey, type ReviewMode } from '../../review/deck';
import { selectShadowingCards } from '../queue';
import {
  EXAMPLE_REPEATS, PAUSE_RANGE, RATES, SHADOWING_SIZES, WORD_REPEATS, type ShadowingPreferences,
} from '../settings';
import type { ShadowingBackend } from '../useShadowingBackend';
import { formatDuration, formatSeconds } from './format';
import { PlaybackMode } from './PlaybackMode';
import { SoundTest } from './SoundTest';

interface Props {
  cards: readonly DeckCard[];
  /** Built-in categories, plus "my words" when the user has personal words. */
  scopes: ReadonlyArray<{ key: PracticeCategoryKey; label: string; theme: string }>;
  backend: ShadowingBackend;
  prefs: ShadowingPreferences;
  onChange(prefs: ShadowingPreferences): void;
  onStart(): void;
  /** The on-device voice (needed for the locked-screen playback mode). */
  onDeviceVoice: ReturnType<typeof useOnDeviceVoice>;
}

const MODE_TEXT: Record<ReviewMode, string> = {
  all: 'همهٔ واژه‌ها',
  unlearned: 'یادنگرفته‌ها',
  learned: 'یادگرفته‌ها',
  again: 'مرور دوباره',
};

/** Re-renders when the browser's voice list changes (voices load asynchronously). */
function useGermanVoice() {
  const { service } = usePronunciation();
  const [status, setStatus] = useState(() => service.germanVoice());
  useEffect(() => {
    setStatus(service.germanVoice());
    return service.onVoicesChanged(() => setStatus(service.germanVoice()));
  }, [service]);
  return { supported: service.supported, status };
}

export function ShadowingSetup({ cards, scopes, backend, prefs, onChange, onStart, onDeviceVoice }: Props) {
  const ids = { size: useId(), word: useId(), example: useId(), pause: useId(), rate: useId(), tr: useId() };
  const voice = useGermanVoice();
  const progress: DeckProgress = { learned: backend.learned, againIds: backend.againIds };
  const selectedCats = new Set(prefs.categories);
  const count = (mode: ReviewMode, cats: ReadonlySet<PracticeCategoryKey> = selectedCats) => selectShadowingCards(cards, mode, cats, progress).length;
  const selected = modeAvailable(prefs.mode, progress) ? count(prefs.mode) : 0;
  const sessionCount = Math.min(selected, prefs.size);
  const audioMode = prefs.playback === 'audio';
  const canPlay = audioMode ? onDeviceVoice.state.kind === 'ready' : voice.supported;
  const set = (patch: Partial<ShadowingPreferences>) => onChange({ ...prefs, ...patch });
  const toggleCategory = (key: PracticeCategoryKey, on: boolean) =>
    set({ categories: on ? [...prefs.categories.filter((k) => k !== key), key] : prefs.categories.filter((k) => k !== key) });

  return (
    <section className="sh-setup" aria-labelledby="sh-title" lang="fa" dir="rtl">
      <div className="rv-hero page-head">
        <span className="rv-hero__icon"><AudioLines /></span>
        <div className="page-head__text">
          <p className="page-head__eyebrow"><span>تمرین</span><span>Shadowing</span></p>
          <h2 id="sh-title" className="page-head__title">تمرین تلفظ (Shadowing)</h2>
          <p className="page-head__sub rv-hero__sub">واژه و جملهٔ آلمانی را بشنو و در مکث بعد از آن، بلند تکرار کن.</p>
          <p className="sh-disclaimer">صدای شما ضبط یا ارزیابی نمی‌شود؛ این تمرینِ شنیدن و تکرار است.</p>
        </div>
      </div>

      <div className="rv-layout">
        <div className="rv-main">
          {!voice.supported && !audioMode ? (
            <p className="rv-notice rv-notice--error" role="alert">این مرورگر از تبدیل متن به گفتار پشتیبانی نمی‌کند؛ تمرین تلفظ در آن ممکن نیست.</p>
          ) : voice.status === 'missing' && !audioMode ? (
            <p className="rv-notice" role="note">صدای آلمانی روی این دستگاه پیدا نشد؛ مرورگر ممکن است متن را با صدای دیگری بخواند. (در تنظیمات زبان سیستم می‌توانید صدای آلمانی نصب کنید.)</p>
          ) : null}

          {backend.status === 'ready' && backend.stats ? (
            <div className="rv-stats">
              <div className="rv-stat"><span className="rv-stat__n">{backend.stats.sessionsCompleted}</span><span className="rv-stat__l">جلسهٔ کامل</span></div>
              <div className="rv-stat"><span className="rv-stat__n">{backend.stats.itemsPracticed}</span><span className="rv-stat__l">واژهٔ تمرین‌شده</span></div>
              <div className="rv-stat"><span className="rv-stat__n" dir="ltr">{formatDuration(backend.stats.practiceMs)}</span><span className="rv-stat__l">زمان تمرین</span></div>
            </div>
          ) : (
            <p className="rv-notice" role="note">
              {backend.status === 'loading'
                ? 'در حال بارگذاری پیشرفت شما…'
                : 'وارد حساب نشده‌اید: می‌توانید تمرین کنید، ولی سابقهٔ تمرین ذخیره نمی‌شود. انتخاب «یادنگرفته»، «یادگرفته» و «مرور دوباره» پس از ورود فعال می‌شود.'}
            </p>
          )}

          <fieldset className="rv-modes">
            <legend>کدام واژه‌ها؟</legend>
            {REVIEW_MODES.map((mode) => {
              const enabled = modeAvailable(mode, progress);
              const n = enabled ? count(mode) : null;
              return (
                <label key={mode} className={`rv-mode${prefs.mode === mode ? ' is-selected' : ''}${enabled ? '' : ' is-disabled'}`}>
                  <input type="radio" name="sh-mode" value={mode} checked={prefs.mode === mode} disabled={!enabled} onChange={() => set({ mode })} />
                  <span className="rv-mode__title">{MODE_TEXT[mode]}</span>
                  <span className="rv-mode__count" aria-label={n === null ? 'پس از ورود' : `${n} واژه`}>{n === null ? <Lock /> : n}</span>
                </label>
              );
            })}
          </fieldset>

          <fieldset className="sh-cats">
            <legend>
              دسته‌ها
              <span className="sh-cats__bulk">
                <button type="button" onClick={() => set({ categories: scopes.map((c) => c.key) })}>همه</button>
                <button type="button" onClick={() => set({ categories: [] })}>هیچ‌کدام</button>
              </span>
            </legend>
            {scopes.map((c) => {
              const on = selectedCats.has(c.key);
              const n = modeAvailable(prefs.mode, progress) ? count(prefs.mode, new Set([c.key])) : 0;
              return (
                <label key={c.key} className={`sh-chip${on ? ' is-selected' : ''}`} data-category={c.theme}>
                  <input type="checkbox" checked={on} onChange={(e) => toggleCategory(c.key, e.currentTarget.checked)} />
                  <span lang="de" dir="ltr">{c.label}</span>
                  <span className="sh-chip__n">{n}</span>
                </label>
              );
            })}
          </fieldset>
        </div>

        <div className="rv-side">
          <p className="rv-side__title">تنظیمات جلسه</p>
          <div className="rv-options sh-options">
            <div className="rv-field">
              <label htmlFor={ids.size}>تعداد واژه در جلسه</label>
              <select id={ids.size} value={prefs.size} onChange={(e) => set({ size: Number(e.currentTarget.value) })}>
                {SHADOWING_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="rv-field">
              <label htmlFor={ids.rate}>سرعت گفتار</label>
              <select id={ids.rate} value={prefs.rate} onChange={(e) => set({ rate: Number(e.currentTarget.value) })}>
                {RATES.map((r) => <option key={r.value} value={r.value}>{r.label} (×{r.value})</option>)}
              </select>
            </div>
            <div className="rv-field">
              <label htmlFor={ids.word}>تکرار هر واژه</label>
              <select id={ids.word} value={prefs.wordRepeats} onChange={(e) => set({ wordRepeats: Number(e.currentTarget.value) })}>
                {WORD_REPEATS.map((n) => <option key={n} value={n}>{n} بار</option>)}
              </select>
            </div>
            <div className="rv-field">
              <label htmlFor={ids.example}>تکرار جملهٔ مثال</label>
              <select id={ids.example} value={prefs.exampleRepeats} onChange={(e) => set({ exampleRepeats: Number(e.currentTarget.value) })}>
                {EXAMPLE_REPEATS.map((n) => <option key={n} value={n}>{n === 0 ? 'بدون جمله' : `${n} بار`}</option>)}
              </select>
            </div>
            <div className="rv-field sh-pause">
              <label htmlFor={ids.pause}>مکث برای تکرار شما: <output htmlFor={ids.pause}>{formatSeconds(prefs.pauseSec)}</output></label>
              <input id={ids.pause} type="range" min={PAUSE_RANGE.min} max={PAUSE_RANGE.max} step={PAUSE_RANGE.step} value={prefs.pauseSec}
                onChange={(e) => set({ pauseSec: Number(e.currentTarget.value) })} />
              <small>بعد از جمله‌ها، مکث به اندازهٔ طول همان جمله بیشتر می‌شود.</small>
            </div>
            <label className="rv-check" htmlFor={ids.tr}>
              <input id={ids.tr} type="checkbox" checked={prefs.showTranslation} onChange={(e) => set({ showTranslation: e.currentTarget.checked })} />
              نمایش ترجمهٔ فارسی
            </label>
          </div>

          <PlaybackMode mode={prefs.playback} onMode={(playback) => set({ playback })} voice={onDeviceVoice.state}
            onDownload={() => { void onDeviceVoice.download(); }} onCancel={onDeviceVoice.cancel} onRemove={() => { void onDeviceVoice.remove(); }} />

          {modeAvailable(prefs.mode, progress) && selected === 0 ? (
            <p className="rv-empty" role="status">{prefs.categories.length === 0 ? 'دست‌کم یک دسته را انتخاب کنید.' : 'در این انتخاب واژه‌ای نیست.'}</p>
          ) : null}
          <button type="button" className="fc-primary rv-start" onClick={onStart} disabled={sessionCount === 0 || !canPlay}>
            {sessionCount === 0 ? 'واژه‌ای برای تمرین نیست' : audioMode ? `آماده‌سازی جلسه (${sessionCount} واژه)` : `شروع تمرین (${sessionCount} واژه)`}
          </button>
          {audioMode && onDeviceVoice.state.kind !== 'ready' && sessionCount > 0 ? (
            <p className="sh-start-hint">برای پخش با صفحهٔ قفل، اول صدای آلمانی را دانلود کنید.</p>
          ) : null}
          <SoundTest voice={onDeviceVoice.state} />
        </div>
      </div>
    </section>
  );
}
