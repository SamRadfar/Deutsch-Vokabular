import { AudioLines, Layers } from 'lucide-react';
import { categoryIcon } from '../vocabulary/categoryIcons';
import './dashboard.css';
import { useMemo, useSyncExternalStore } from 'react';
import type { Category, CategoryKey } from '../../models/vocabulary';
import { useProgress } from '../progress/ProgressProvider';
import { describeSync } from '../account/SyncStatusIndicator';
import type { ReviewSnapshot } from '../review/reviewLog';
import type { ShadowingLogSnapshot } from '../shadowing/shadowingLog';
import { formatDuration } from '../shadowing/components/format';
import { learningOverview, reviewActivity } from './stats';
import { usePersonal } from '../personal/usePersonal';

interface Props {
  categories: readonly Category[];
  onOpenCategory(key: CategoryKey): void;
  onOpenReview(): void;
  onOpenShadowing(): void;
  onOpenPersonal(): void;
}

const noop = () => () => {};
const none = () => null;
const dateFmt = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (ms: number | null) => (ms === null ? '—' : dateFmt.format(ms));

/** Circular progress (decorative SVG; the number is in the accessible text next to it). */
function Ring({ percent }: { percent: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg className="db-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle className="db-ring__track" cx="50" cy="50" r={r} />
      <circle className="db-ring__value" cx="50" cy="50" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} />
      <text x="50" y="50" className="db-ring__text" dominantBaseline="central" textAnchor="middle">{percent}%</text>
    </svg>
  );
}

export function Dashboard({ categories, onOpenCategory, onOpenReview, onOpenShadowing, onOpenPersonal }: Props) {
  const progress = useProgress();
  const ready = progress.status === 'ready' ? progress : null;
  const reviews: ReviewSnapshot | null = useSyncExternalStore(ready?.reviews.subscribe ?? noop, ready?.reviews.getSnapshot ?? none, ready?.reviews.getSnapshot ?? none);
  const shadow: ShadowingLogSnapshot | null = useSyncExternalStore(ready?.shadowing.subscribe ?? noop, ready?.shadowing.getSnapshot ?? none, ready?.shadowing.getSnapshot ?? none);

  const { snapshot: personal } = usePersonal();
  // Practice statistics count built-in words and the current personal words (deleted ones drop out).
  const knownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of categories) for (const s of c.subtabs) for (const g of s.groups) for (const e of g.entries) ids.add(e.id);
    for (const w of personal?.words ?? []) ids.add(w.id);
    return ids;
  }, [categories, personal]);
  const personalLearned = personal?.words.filter((w) => w.learned).length ?? 0;
  const learned = ready?.view.learned ?? null;
  const overview = useMemo(() => learningOverview(categories, learned ?? new Set()), [categories, learned]);
  const activity = useMemo(() => (reviews ? reviewActivity(reviews.records, knownIds) : null), [reviews, knownIds]);
  const sync = ready ? describeSync(ready.view.status) : null;
  const stats = shadow?.stats ?? null;
  const hasLocalPractice = !!activity && (activity.reviewedWords > 0 || (stats?.itemsPracticed ?? 0) > 0 || (stats?.practiceMs ?? 0) > 0);

  return (
    <section className="db" aria-labelledby="db-title" lang="fa" dir="rtl">
      <div className="db__head page-head">
        <div className="page-head__text">
          <p className="page-head__eyebrow"><span>داشبورد</span><span>{overview.total ? `${overview.total.toLocaleString('fa-IR')} واژهٔ تخصصی` : 'واژه‌های شخصی'}</span></p>
          <h2 id="db-title" className="page-head__title">پیشرفت یادگیری</h2>
          {sync ? <p className={`db__sync db__sync--${sync.tone}`} data-testid="db-sync">پیشرفت همگام با حساب شما: {sync.text}</p> : null}
        </div>
      </div>

      {progress.status === 'unavailable' ? (
        <p className="rv-notice" role="note">
          برای ثبت پیشرفت و همگام‌سازی آن بین دستگاه‌ها با گوگل وارد شوید. بدون ورود هم می‌توانید همهٔ {overview.total} واژه را ببینید و تمرین کنید، ولی چیزی ذخیره نمی‌شود.
        </p>
      ) : progress.status === 'loading' ? (
        <p className="rv-notice" role="status">در حال بارگذاری پیشرفت شما…</p>
      ) : null}

      <div className="db-grid">
        <div className="db-col">
          <div className="db-card db-summary" data-testid="db-summary">
            {ready ? <Ring percent={overview.percent} /> : null}
            <dl className="db-summary__nums">
              <div><dt>کل واژه‌ها</dt><dd data-testid="db-total">{overview.total}</dd></div>
              {ready ? (
                <>
                  <div><dt>یادگرفته</dt><dd className="db-ok" data-testid="db-learned">{overview.learned}</dd></div>
                  <div><dt>باقی‌مانده</dt><dd data-testid="db-remaining">{overview.remaining}</dd></div>
                  <div><dt>پیشرفت کل</dt><dd data-testid="db-percent"><span dir="ltr">{overview.percent}%</span></dd></div>
                </>
              ) : (
                <div><dt>دسته‌ها</dt><dd>{overview.categories.length}</dd></div>
              )}
            </dl>
          </div>

          {overview.categories.length ? (
            <div className="db-card">
              <h3 className="db-card__title">{ready ? `پیشرفت در هر دسته (${overview.total.toLocaleString('fa-IR')} واژه، همگام با حساب)` : 'دسته‌ها'}</h3>
              <ul className="db-cats">
                {overview.categories.map((c) => (
                  <li key={c.key} data-category={c.theme}>
                    <button type="button" className="db-cat" onClick={() => onOpenCategory(c.key)} aria-label={ready ? `${c.label}: ${c.learned} از ${c.total} یادگرفته (${c.percent}٪) — نمایش واژه‌ها` : `${c.label}: ${c.total} واژه — نمایش واژه‌ها`}>
                      <span className="db-cat__label" lang="de" dir="ltr">{(() => { const Icon = categoryIcon(c.key); return Icon ? <Icon className="db-cat__icon" /> : null; })()}{c.label}</span>
                      <span className="db-cat__count"><span dir="ltr">{ready ? `${c.learned}/${c.total}` : c.total}</span></span>
                      {ready ? (
                        <span className="db-bar" aria-hidden="true">
                          <span style={{ width: `${c.percent}%` }} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="db-col db-col--side">
          <div className="db-actions">
            <button type="button" className="db-action" onClick={onOpenReview}>
              <span className="db-action__icon"><Layers /></span>
              <span className="db-action__title">مرور با فلش‌کارت</span>
              <span className="db-action__sub">
                {ready && activity ? `${overview.remaining} واژهٔ یادنگرفته · ${activity.againList} در فهرست مرور دوباره` : 'کارت‌ها را برگردان و بسنج چه چیزی را بلدی'}
              </span>
            </button>
            <button type="button" className="db-action" onClick={onOpenShadowing}>
              <span className="db-action__icon"><AudioLines /></span>
              <span className="db-action__title">تمرین تلفظ</span>
              <span className="db-action__sub">بشنو و بلند تکرار کن (Shadowing)</span>
            </button>
          </div>

          {ready && personal ? (
            <div className="db-card db-personal" data-testid="db-personal">
              <div>
                <h3 className="db-card__title">واژه‌های من</h3>
                <p className="db-card__note">
                  {personal.words.length
                    ? `${personal.words.length} واژهٔ شخصی، ${personalLearned} یادگرفته — ${personal.sync.mode === 'cloud' ? 'همگام با حساب شما (Firestore).' : 'روی همین دستگاه ذخیره می‌شود (همگام‌سازی ابری هنوز فعال نیست).'}`
                    : 'هنوز واژهٔ شخصی‌ای اضافه نکرده‌اید.'}
                </p>
              </div>
              <button type="button" className="fc-secondary" onClick={onOpenPersonal}>{personal.words.length ? 'مدیریت واژه‌های من' : 'افزودن واژه'}</button>
            </div>
          ) : null}

          {ready ? (
            <div className="db-card" data-testid="db-local">
              <h3 className="db-card__title">تمرین روی همین دستگاه</h3>
              <p className="db-card__note">این آمار فقط روی همین مرورگر ذخیره می‌شود و بین دستگاه‌ها همگام نمی‌شود.</p>
              {hasLocalPractice && activity && stats ? (
                <div className="db-local">
                  <dl className="db-kv">
                    <dt>فلش‌کارت: واژه‌های مرورشده</dt><dd data-testid="db-reviewed">{activity.reviewedWords}</dd>
                    <dt>پاسخ «بلدم» / «بلد نیستم»</dt><dd><span dir="ltr">{activity.knowAnswers} / {activity.againAnswers}</span></dd>
                    <dt>در فهرست مرور دوباره</dt><dd>{activity.againList}</dd>
                    <dt>آخرین مرور</dt><dd>{formatDate(activity.lastReviewedAt)}</dd>
                  </dl>
                  <dl className="db-kv">
                    <dt>تلفظ: جلسه‌های کامل</dt><dd data-testid="db-shadow-sessions">{stats.sessionsCompleted}</dd>
                    <dt>واژه‌های تمرین‌شده</dt><dd>{stats.itemsPracticed}</dd>
                    <dt>زمان تمرین</dt><dd><span dir="ltr">{formatDuration(stats.practiceMs)}</span></dd>
                    <dt>آخرین جلسه</dt><dd>{formatDate(stats.lastSessionAt)}</dd>
                  </dl>
                </div>
              ) : (
                <p className="db-empty" role="status">هنوز تمرینی روی این دستگاه ثبت نشده است. با فلش‌کارت یا تمرین تلفظ شروع کنید.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
