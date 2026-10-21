import { ArrowDown, Mic, Timer } from 'lucide-react';
import { Fragment, useId, useMemo } from 'react';
import { planItem, wantsPersian, type Step } from '../plan';
import {
  DE_FA_DELAYS, EXAMPLE_REPEATS, FA_EXAMPLE_REPEATS, FA_MEANING_REPEATS, PAUSE_RANGE, RATES, WORD_REPEATS, type ShadowingPreferences,
} from '../settings';
import { VoiceDownload } from '../../pronunciation/VoiceDownload';
import { formatSeconds } from './format';

interface Props {
  prefs: ShadowingPreferences;
  set(patch: Partial<ShadowingPreferences>): void;
  /** The Persian voice is downloaded on this device. */
  persianReady: boolean;
}

const sec = (s: number) => (s === 0 ? 'بدون مکث' : `${formatSeconds(s)}`);

/** «ترتیب و تکرار تلفظ»: repetitions, German→Persian delay, pauses, speeds — and the live order preview. */
export function SequenceSettings({ prefs, set, persianReady }: Props) {
  const id = useId();
  const f = (name: string) => `${id}-${name}`;
  const persian = wantsPersian(prefs);
  return (
    <fieldset className="sh-seq" data-testid="sh-sequence">
      <legend>ترتیب و تکرار تلفظ</legend>
      <div className="sh-seq__grid">
        <div className="rv-field">
          <label htmlFor={f('w')}>تکرار واژه آلمانی</label>
          <select id={f('w')} value={prefs.wordRepeats} onChange={(e) => set({ wordRepeats: Number(e.currentTarget.value) })}>
            {WORD_REPEATS.map((n) => <option key={n} value={n}>{n} بار</option>)}
          </select>
        </div>
        <div className="rv-field">
          <label htmlFor={f('m')}>تکرار معنی فارسی</label>
          <select id={f('m')} value={prefs.faMeaningRepeats} onChange={(e) => set({ faMeaningRepeats: Number(e.currentTarget.value) })}>
            {FA_MEANING_REPEATS.map((n) => <option key={n} value={n}>{n === 0 ? 'بدون فارسی' : `${n} بار پس از هر واژه`}</option>)}
          </select>
        </div>
        <div className="rv-field">
          <label htmlFor={f('e')}>تکرار جمله مثال آلمانی</label>
          <select id={f('e')} value={prefs.exampleRepeats} onChange={(e) => set({ exampleRepeats: Number(e.currentTarget.value) })}>
            {EXAMPLE_REPEATS.map((n) => <option key={n} value={n}>{n === 0 ? 'بدون جمله' : `${n} بار`}</option>)}
          </select>
        </div>
        <div className="rv-field sh-seq__exfa">
          <label className="rv-check" htmlFor={f('xfa')}>
            <input id={f('xfa')} type="checkbox" checked={prefs.faExample} disabled={prefs.exampleRepeats === 0}
              onChange={(e) => set({ faExample: e.currentTarget.checked })} />
            خواندن ترجمه فارسی جمله
          </label>
          <select aria-label="تکرار ترجمه فارسی جمله" value={prefs.faExampleRepeats} disabled={!prefs.faExample || prefs.exampleRepeats === 0}
            onChange={(e) => set({ faExampleRepeats: Number(e.currentTarget.value) })}>
            {FA_EXAMPLE_REPEATS.map((n) => <option key={n} value={n}>{n === 0 ? 'هیچ' : `${n} بار`}</option>)}
          </select>
        </div>
        <div className="rv-field">
          <label htmlFor={f('d')}>مکث بین آلمانی و فارسی</label>
          <select id={f('d')} value={prefs.deFaDelaySec} disabled={!persian} onChange={(e) => set({ deFaDelaySec: Number(e.currentTarget.value) })}>
            {DE_FA_DELAYS.map((n) => <option key={n} value={n}>{n === 0 ? 'بدون مکث' : formatSeconds(n)}</option>)}
          </select>
        </div>
        <div className="rv-field sh-pause">
          <label htmlFor={f('p')}>مکث برای تکرار شما: <output htmlFor={f('p')}>{sec(prefs.pauseSec)}</output></label>
          <input id={f('p')} type="range" min={PAUSE_RANGE.min} max={PAUSE_RANGE.max} step={PAUSE_RANGE.step} value={prefs.pauseSec}
            onChange={(e) => set({ pauseSec: Number(e.currentTarget.value) })} />
          <small>پس از هر دور واژه و هر جمله؛ پس از جمله‌ها به اندازهٔ طول همان جمله بیشتر می‌شود. ۰ = پخش پشت‌سرهم.</small>
        </div>
        <div className="rv-field">
          <label htmlFor={f('r')}>سرعت گفتار آلمانی</label>
          <select id={f('r')} value={prefs.rate} onChange={(e) => set({ rate: Number(e.currentTarget.value) })}>
            {RATES.map((r) => <option key={r.value} value={r.value}>{r.label} (×{r.value})</option>)}
          </select>
        </div>
        <div className="rv-field">
          <label htmlFor={f('fr')}>سرعت گفتار فارسی</label>
          <select id={f('fr')} value={prefs.faRate} disabled={!persian} onChange={(e) => set({ faRate: Number(e.currentTarget.value) })}>
            {RATES.map((r) => <option key={r.value} value={r.value}>{r.label} (×{r.value})</option>)}
          </select>
        </div>
      </div>

      <SequencePreview prefs={prefs} />

      {persian && !persianReady ? (
        <div className="sh-seq__voice">
          <p className="rv-notice" role="note">برای خواندن معنی و ترجمهٔ فارسی، صدای فارسی روی همین دستگاه لازم است (رایگان، آفلاین).</p>
          <VoiceDownload voice="fa" />
        </div>
      ) : null}
    </fieldset>
  );
}

type Line = { kind: 'cycle'; n: number; parts: string[] } | { kind: 'block'; parts: string[] } | { kind: 'next' };

/** Groups the real plan of a sample item into readable lines (the preview is the plan itself). */
export function previewLines(prefs: ShadowingPreferences): Line[] {
  const steps: Step[] = planItem({ word: 'Wort', example: 'Beispiel.', fa: 'معنی', exampleFa: 'ترجمه' }, prefs);
  const lines: Line[] = [];
  let cur: Exclude<Line, { kind: 'next' }> | null = null;
  const push = () => { if (cur) lines.push(cur); cur = null; };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.kind === 'speak' && s.target === 'word') { push(); cur = { kind: 'cycle', n: s.repetition, parts: [] }; }
    if (s.kind === 'speak' && s.target === 'example' && s.repetition === 1) { push(); cur = { kind: 'block', parts: [] }; }
    const next = steps[i + 1];
    const startsFaExample = (s.kind === 'speak' && s.target === 'exampleFa' && s.repetition === 1 && steps[i - 1]?.kind !== 'pause')
      || (s.kind === 'pause' && s.purpose === 'gap' && s.target === 'exampleFa' && next?.kind === 'speak' && next.repetition === 1);
    if (startsFaExample) { push(); cur = { kind: 'block', parts: [] }; }
    if (!cur) cur = { kind: 'block', parts: [] };
    const parts: string[] = cur.parts;
    if (s.kind === 'speak') {
      const label = s.target === 'word' ? 'DE واژه' : s.target === 'meaning' ? 'FA معنی' : s.target === 'example' ? 'DE مثال' : 'FA ترجمهٔ مثال';
      // Collapse a run of the same speak step (with its own pauses) into "× n".
      if (s.target === 'example' || s.target === 'exampleFa' || s.target === 'meaning') {
        if (s.repetition === 1) parts.push(s.of > 1 ? `${label} × ${s.of}` : label);
      } else parts.push(label);
    } else if (s.purpose === 'gap') {
      const prev = steps[i - 1];
      if (!(prev?.kind === 'speak' && prev.lang === 'fa')) parts.push(`⏱ ${formatSeconds(s.baseMs / 1000)}`);
    } else if (s.target === 'word' || s.target === 'exampleFa' || s.repetition === s.of) {
      parts.push(`🗣 ${formatSeconds(s.baseMs / 1000)}${s.extendBySpeech ? '+' : ''}${s.target === 'example' && s.of > 1 ? ' هر بار' : ''}`);
    }
  }
  push();
  lines.push({ kind: 'next' });
  return lines;
}

/** "DE مثال × 2" → [DE] مثال ×2 — each part isolated so the bidi order stays right. */
function ChipText({ text }: { text: string }) {
  const m = /^(DE|FA) (.+?)(?: × (\d+))?$/.exec(text);
  if (!m) return <bdi>{text}</bdi>;
  return (
    <>
      <span className="sh-chip-step__lang" dir="ltr">{m[1]}</span>
      <bdi>{m[2]}</bdi>
      {m[3] ? <span className="sh-chip-step__n" dir="ltr">×{m[3]}</span> : null}
    </>
  );
}

function SequencePreview({ prefs }: { prefs: ShadowingPreferences }) {
  const lines = useMemo(() => previewLines(prefs), [prefs]);
  return (
    <div className="sh-preview" data-testid="sh-preview" aria-label="پیش‌نمایش ترتیب پخش برای هر واژه">
      <p className="sh-preview__title"><Timer aria-hidden="true" /> ترتیب پخش برای هر واژه</p>
      <ol>
        {lines.map((l, i) => (
          <li key={i} className={`sh-preview__line sh-preview__line--${l.kind}`} dir="rtl">
            {l.kind === 'next' ? <span className="sh-preview__next"><ArrowDown aria-hidden="true" /> واژهٔ بعدی</span> : l.parts.map((p, j) => (
              <Fragment key={j}>
                {j > 0 ? <span className="sh-preview__arrow" aria-hidden="true">←</span> : null}
                <span className={`sh-chip-step${p.startsWith('DE') ? ' is-de' : p.startsWith('FA') ? ' is-fa' : p.startsWith('🗣') ? ' is-turn' : ' is-gap'}`}>
                  {p.startsWith('🗣') ? <><Mic aria-hidden="true" /><bdi>{p.slice(2).trim()}</bdi></> : <ChipText text={p} />}
                </span>
              </Fragment>
            ))}
          </li>
        ))}
      </ol>
      <p className="sh-preview__legend">DE = آلمانی · FA = فارسی · ⏱ مکث بین آلمانی و فارسی · <Mic aria-hidden="true" /> نوبت شما برای تکرار</p>
    </div>
  );
}
