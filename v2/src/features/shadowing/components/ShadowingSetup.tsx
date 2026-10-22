import { AudioLines, Lock, Volume2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { isAppleMobile } from '../../audio/routedSpeech';
import { onDeviceVoiceStore, useOnDeviceVoice } from '../../audio/useOnDeviceVoice';
import { wantsPersian } from '../plan';
import { SequenceSettings } from './SequenceSettings';
import { usePronunciation } from '../../pronunciation/PronunciationProvider';
import { modeAvailable, REVIEW_MODES, type DeckCard, type DeckProgress, type PracticeCategoryKey, type ReviewMode } from '../../review/deck';
import { selectShadowingCards } from '../queue';
import type { SubScope } from '../../categories/practiceSubs';
import { SHADOWING_SIZES, type ShadowingPreferences } from '../settings';
import type { ShadowingBackend } from '../useShadowingBackend';
import { formatDuration } from './format';
import { PlaybackMode } from './PlaybackMode';

interface Props {
  cards: readonly DeckCard[];
  /** Built-in categories, plus "my words" when the user has personal words. */
  scopes: ReadonlyArray<{ key: PracticeCategoryKey; label: string; theme: string }>;
  /** Subcategories of the selected main category ([] = no second row). */
  subs: readonly SubScope[];
  backend: ShadowingBackend;
  prefs: ShadowingPreferences;
  onChange(prefs: ShadowingPreferences): void;
  onStart(): void;
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

export function ShadowingSetup({ cards, scopes, subs, backend, prefs, onChange, onStart }: Props) {
  const ids = { size: useId(), tr: useId(), cat: useId(), sub: useId() };
  const voice = useGermanVoice();
  const { state: deviceVoice } = useOnDeviceVoice();
  const { state: faVoice } = useOnDeviceVoice(onDeviceVoiceStore('fa'));
  const needsPersian = wantsPersian(prefs) && faVoice.kind !== 'ready';
  const { routed, openSoundSettings } = usePronunciation();
  const progress: DeckProgress = { learned: backend.learned, againIds: backend.againIds };
  const selectedCats = new Set(prefs.categories);
  const count = (mode: ReviewMode, cats: ReadonlySet<PracticeCategoryKey> = selectedCats, sub: string | null = prefs.subcategory) =>
    selectShadowingCards(cards, mode, cats, progress, sub).length;
  const allKeys = scopes.map((c) => c.key);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedCats.has(k));
  const activeMain = prefs.categories.length === 1 ? prefs.categories[0]! : null;
  const activeScope = scopes.find((c) => c.key === activeMain);
  const selected = modeAvailable(prefs.mode, progress) ? count(prefs.mode) : 0;
  const sessionCount = Math.min(selected, prefs.size);
  const audioMode = prefs.playback === 'audio';
  const canPlay = audioMode ? deviceVoice.kind === 'ready' : voice.supported || deviceVoice.kind === 'ready';
  const iosBrowserSpeech = !audioMode && Boolean(routed) && isAppleMobile() && routed?.route() === 'browser';
  const set = (patch: Partial<ShadowingPreferences>) => onChange({ ...prefs, ...patch });
  // One main category at a time (its subcategories appear below); «همهٔ دسته‌ها» selects them all.
  // Changing the main category always resets the subcategory to «همه زیرمجموعه‌ها».
  const selectMain = (key: PracticeCategoryKey) => set({ categories: [key], subcategory: null });
  const modeOk = modeAvailable(prefs.mode, progress);

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
          ) : iosBrowserSpeech ? (
            <p className="rv-notice" role="note">روی iPhone صدای مرورگر در حالت بی‌صدا شنیده نمی‌شود. برای پخش مطمئن، در «تنظیمات و آزمایش صدا» صدای آلمانی دستگاه را دانلود کنید.</p>
          ) : voice.status === 'missing' && !audioMode && routed?.route() !== 'device' ? (
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

          <fieldset className="sh-cats" data-testid="sh-cats">
            <legend>دسته‌بندی</legend>
            <label className={`sh-chip${allSelected ? ' is-selected' : ''}`}>
              <input type="radio" name={ids.cat} checked={allSelected} onChange={() => set({ categories: allKeys, subcategory: null })} />
              <span>همهٔ دسته‌ها</span>
              <span className="sh-chip__n">{modeOk ? count(prefs.mode, new Set(allKeys), null) : 0}</span>
            </label>
            {scopes.map((c) => {
              const on = !allSelected && selectedCats.has(c.key);
              const n = modeOk ? count(prefs.mode, new Set([c.key]), null) : 0;
              return (
                <label key={c.key} className={`sh-chip${on ? ' is-selected' : ''}`} data-category={c.theme}>
                  <input type="radio" name={ids.cat} checked={on && activeMain === c.key} onChange={() => selectMain(c.key)} />
                  <span lang="de" dir="auto">{c.label}</span>
                  <span className="sh-chip__n">{n}</span>
                </label>
              );
            })}
          </fieldset>

          {activeMain && subs.length ? (
            <fieldset className="sh-subs" data-testid="sh-subs" data-category={activeScope?.theme}>
              <legend className="visually-hidden">زیرمجموعه‌های {activeScope?.label}</legend>
              <label className={`sh-chip sh-chip--sub${prefs.subcategory === null ? ' is-selected' : ''}`}>
                <input type="radio" name={ids.sub} checked={prefs.subcategory === null} onChange={() => set({ subcategory: null })} />
                <span>همه زیرمجموعه‌ها</span>
                <span className="sh-chip__n">{modeOk ? count(prefs.mode, selectedCats, null) : 0}</span>
              </label>
              {subs.map((sub) => (
                <label key={sub.id} className={`sh-chip sh-chip--sub${prefs.subcategory === sub.id ? ' is-selected' : ''}${sub.own ? ' is-own' : ''}`}>
                  <input type="radio" name={ids.sub} checked={prefs.subcategory === sub.id} onChange={() => set({ subcategory: sub.id })} />
                  <span dir="auto">{sub.label}</span>
                  <span className="sh-chip__n">{modeOk ? count(prefs.mode, selectedCats, sub.id) : 0}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
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
            <label className="rv-check" htmlFor={ids.tr}>
              <input id={ids.tr} type="checkbox" checked={prefs.showTranslation} onChange={(e) => set({ showTranslation: e.currentTarget.checked })} />
              نمایش ترجمهٔ فارسی
            </label>
          </div>

          <SequenceSettings prefs={prefs} set={set} persianReady={faVoice.kind === 'ready'} />

          <PlaybackMode mode={prefs.playback} onMode={(playback) => set({ playback })} />

          {modeAvailable(prefs.mode, progress) && selected === 0 ? (
            <p className="rv-empty" role="status" data-testid="sh-empty">{prefs.categories.length === 0 ? 'یک دسته را انتخاب کنید.' : 'در این انتخاب (دسته، زیرمجموعه و «کدام واژه‌ها؟») واژه‌ای نیست.'}</p>
          ) : null}
          <button type="button" className="fc-primary rv-start" onClick={onStart} disabled={sessionCount === 0 || !canPlay || needsPersian}>
            {sessionCount === 0 ? 'واژه‌ای برای تمرین نیست' : audioMode ? `آماده‌سازی جلسه (${sessionCount} واژه)` : `شروع تمرین (${sessionCount} واژه)`}
          </button>
          {needsPersian && sessionCount > 0 ? (
            <p className="sh-start-hint" data-testid="sh-needs-fa">برای خواندن فارسی، اول صدای فارسی را دانلود کنید یا «تکرار معنی فارسی» و ترجمهٔ جمله را خاموش کنید.</p>
          ) : null}
          {audioMode && deviceVoice.kind !== 'ready' && sessionCount > 0 ? (
            <p className="sh-start-hint">برای پخش با صفحهٔ قفل، اول صدای آلمانی را دانلود کنید.</p>
          ) : null}
          <button type="button" className="fc-tool sh-sound-btn" onClick={openSoundSettings}>
            <Volume2 aria-hidden="true" /> تنظیمات و آزمایش صدا
          </button>
        </div>
      </div>
    </section>
  );
}
