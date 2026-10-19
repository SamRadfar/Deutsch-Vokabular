import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { getBundledRepository as getVocabularyRepository } from '../../../src/services/content/bundled';
import { fakeSpeech, mockMatchMedia, MOBILE, waitForApp, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { categoryName } from '../../../src/models/vocabulary';

const repo = getVocabularyRepository();
const AUSSENWAND = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!; // die Außenwand
const fitness = repo.getCategory('fitness')!;
const fitnessWord = fitness.subtabs[1]!.groups[0]!.entries[0]!;

beforeEach(() => mockMatchMedia(() => false));

const searchBox = () => screen.getByRole('searchbox', { name: 'جستجوی واژه' });
const count = () => screen.getByTestId('search-count').textContent;
const results = () => screen.queryByRole('list', { name: 'نتیجه‌های جستجو' });
const resultIds = () => [...(results()?.querySelectorAll('article[data-entry-id]') ?? [])].map((a) => a.getAttribute('data-entry-id'));
const link = (name: string) => screen.getByRole('link', { name });

async function asOwner() {
  const user = userEvent.setup();
  const env = createFakeServices({ restored: ALICE });
  render(<App services={env.services} speechService={fakeSpeech()} />);
  await waitForApp();
  return { user, env };
}
async function signedIn() {
  const user = userEvent.setup();
  const env = createFakeServices({ restored: ALICE });
  render(<App services={env.services} speechService={fakeSpeech()} />);
  await waitForLearnedCheckboxes();
  return { user, env };
}

describe('navigation', () => {
  it('main sections as links with aria-current; categories are secondary tabs of "words"', async () => {
    const { user } = await asOwner();
    const nav = screen.getByRole('navigation', { name: 'بخش‌های اصلی' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['واژه‌ها', 'واژه‌های من', 'مرور', 'تلفظ', 'پیشرفت']);
    expect(link('واژه‌ها')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('tablist', { name: 'Kategorien' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toMatch(/^واژه‌ها · /));

    await user.click(link('پیشرفت'));
    expect(window.location.hash).toBe('#/progress');
    expect(link('پیشرفت')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'پیشرفت یادگیری' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Kategorien' })).toBeNull(); // no category tabs outside "words"
    expect(document.title).toMatch(/^پیشرفت یادگیری · /);
  });

  it('follows the URL hash (back button, deep links)', async () => {
    window.history.replaceState(null, '', '#/shadowing');
    await asOwner();
    expect(screen.getByRole('heading', { name: 'تمرین تلفظ (Shadowing)' })).toBeInTheDocument();
    act(() => { window.location.hash = '#/review'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByRole('heading', { name: 'مرور با فلش‌کارت' })).toBeInTheDocument();
    expect(link('مرور')).toHaveAttribute('aria-current', 'page');
  });

  it('phones and tablets get a compact app bar and a bottom tab bar; the category tabs are part of the page', async () => {
    mockMatchMedia(MOBILE);
    await asOwner();
    const nav = screen.getByRole('navigation', { name: 'بخش‌های اصلی' });
    expect(nav).toHaveClass('pnav--bottom');
    expect(nav.closest('header')).toBeNull();
    expect(screen.getByRole('main')).toHaveClass('mcontent--bottom-nav');
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Kategorien' }).closest('main')).not.toBeNull();
  });

  it('desktop (≥ 1024px): grouped sidebar navigation that collapses to an icon rail and remembers it', async () => {
    mockMatchMedia((q) => q.includes('min-width: 1024px'));
    const { user } = await asOwner();
    const sidebar = screen.getByTestId('sidebar');
    const nav = within(sidebar).getByRole('navigation', { name: 'بخش‌های اصلی' });
    expect(nav).toHaveClass('pnav--sidebar');
    expect(within(nav).getAllByRole('list').map((l) => l.getAttribute('aria-labelledby'))).toEqual(['pnav-learn', 'pnav-personal']);
    expect(within(nav).getByRole('link', { name: 'واژه‌ها' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'بخش‌های اصلی' })?.classList.contains('pnav--bottom')).toBe(false);
    expect(screen.getByRole('main')).not.toHaveClass('mcontent--bottom-nav');
    await user.click(screen.getByRole('button', { name: 'جمع کردن نوار کناری' }));
    expect(sidebar).toHaveClass('is-collapsed');
    // Collapsed items keep their names (tooltips + accessible names).
    expect(within(nav).getByRole('link', { name: 'مرور' }).querySelector('.tip')).toHaveTextContent('مرور');
    expect(window.localStorage.getItem('dv2.pref.sidebar.v1')).toBe('"collapsed"');
    await user.click(screen.getByRole('button', { name: 'باز کردن نوار کناری' }));
    expect(sidebar).not.toHaveClass('is-collapsed');
  });

  it('phones fold the search filters behind a «فیلترها» button that shows the number of active filters', async () => {
    mockMatchMedia(MOBILE);
    const { user } = await asOwner();
    expect(searchBox()).toBeVisible();
    const toggle = screen.getByRole('button', { name: /فیلترها/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'دسته' })).toBeNull(); // hidden
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.selectOptions(screen.getByRole('combobox', { name: 'دسته' }), 'fitness');
    expect(toggle).toHaveTextContent('فیلترها (1)');
    await user.click(screen.getByRole('button', { name: 'پاک کردن' }));
    expect(toggle).toHaveTextContent(/فیلترها$/);
  });

  it('a skip link moves focus to the main content without changing the section', async () => {
    const { user } = await asOwner();
    await user.click(link('مرور'));
    await user.click(screen.getByRole('link', { name: 'رفتن به محتوای اصلی' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/review');
  });
});

describe('vocabulary search', () => {
  it('German search with ß/ss and umlaut folding, highlighted safely, with a result count', async () => {
    const { user } = await asOwner();
    await user.type(searchBox(), 'aussenwand');
    await waitFor(() => expect(resultIds()[0]).toBe(AUSSENWAND.id));
    expect(count()).toMatch(/^\d+ واژه پیدا شد$/);
    const card = results()!.querySelector(`article[data-entry-id="${AUSSENWAND.id}"]`)!;
    expect([...card.querySelectorAll('mark')].map((m) => m.textContent)).toContain('Außenwand');
    expect(screen.queryByRole('tablist', { name: /Unterbereiche/ })).toBeNull(); // results replace the category view
  });

  it('Persian search (Arabic letter variants) and example sentences', async () => {
    const { user } = await asOwner();
    await user.type(searchBox(), 'ديوار خارجي');
    await waitFor(() => expect(resultIds()).toContain(AUSSENWAND.id));
    await user.clear(searchBox());
    await user.type(searchBox(), 'gut gedämmt');
    await waitFor(() => expect(resultIds()).toContain(AUSSENWAND.id));
  });

  it('never injects HTML: markup typed into the search is plain text', async () => {
    const { user } = await asOwner();
    await user.type(searchBox(), '<img src=x onerror=alert(1)>');
    await waitFor(() => expect(count()).toBe('نتیجه‌ای پیدا نشد'));
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(/واژه‌ای پیدا نشد/)).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('category and subcategory filters combine with the query; reset restores browsing', async () => {
    const { user } = await asOwner();
    await user.selectOptions(screen.getByRole('combobox', { name: 'دسته' }), 'fitness');
    const sub = screen.getByRole('combobox', { name: 'زیرمجموعه' });
    expect(sub).toBeEnabled();
    await user.selectOptions(sub, fitness.subtabs[1]!.id);
    const subTotal = fitness.subtabs[1]!.groups.reduce((n, g) => n + g.entries.length, 0);
    await waitFor(() => expect(count()).toBe(`${subTotal} واژه پیدا شد`));
    await user.type(searchBox(), fitnessWord.word.replace(/^(der|die|das) /, ''));
    await waitFor(() => expect(resultIds()).toContain(fitnessWord.id));
    expect(resultIds().every((id) => fitness.subtabs[1]!.groups.some((g) => g.entries.some((e) => e.id === id)))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'پاک کردن جستجو و فیلترها' }));
    expect(searchBox()).toHaveValue('');
    expect(screen.getByRole('tablist', { name: /Unterbereiche/ })).toBeInTheDocument();
  });

  it('meaningful empty state', async () => {
    const { user } = await asOwner();
    await user.type(searchBox(), 'qqqzzz');
    await waitFor(() => expect(screen.getByText('برای «qqqzzz» واژه‌ای پیدا نشد')).toBeInTheDocument());
    expect(screen.getByText(/بدون حرف تعریف یا با ss به‌جای ß/)).toBeInTheDocument();
  });

  it('learned/unlearned filters follow progress changes; a just-toggled word stays visible', async () => {
    const { user, env } = await signedIn();
    await user.type(searchBox(), 'außenwand');
    await user.click(screen.getByRole('radio', { name: 'یادنگرفته' }));
    await waitFor(() => expect(resultIds()[0]).toBe(AUSSENWAND.id));
    const before = resultIds().length;
    const box = within(results()!.querySelector(`article[data-entry-id="${AUSSENWAND.id}"]`) as HTMLElement).getByRole('checkbox');
    await user.click(box);
    expect(box).toBeChecked();
    await waitFor(() => expect(env.cloud.serverState(ALICE.uid).get(AUSSENWAND.id)).toBe(true));
    expect(resultIds()).toContain(AUSSENWAND.id); // not yanked away under the cursor
    expect(resultIds()).toHaveLength(before);
    await user.click(screen.getByRole('radio', { name: 'یادگرفته' }));
    await waitFor(() => expect(resultIds()).toEqual([AUSSENWAND.id]));
    await user.click(screen.getByRole('radio', { name: 'یادنگرفته' }));
    await waitFor(() => expect(resultIds()).not.toContain(AUSSENWAND.id)); // filter changed: now applied
  });

  it('"show in list" opens the category and subcategory and focuses the entry', async () => {
    const { user } = await asOwner();
    await user.type(searchBox(), fitnessWord.word);
    await waitFor(() => expect(resultIds()).toContain(fitnessWord.id));
    const card = results()!.querySelector(`article[data-entry-id="${fitnessWord.id}"]`) as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'نمایش در فهرست' }));
    expect(screen.getByRole('tab', { name: categoryName(fitness.label) })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tablist', { name: /Unterbereiche/ })).getByRole('tab', { selected: true })).toHaveTextContent(fitness.subtabs[1]!.label);
    const row = document.querySelector(`tr[data-entry-id="${fitnessWord.id}"]`)!;
    expect(row).toHaveClass('is-focused');
    await waitFor(() => expect(row).toHaveFocus());
    expect(searchBox()).toHaveValue('');
  });

  it('keyboard: "/" focuses the search, Escape clears it', async () => {
    const { user } = await asOwner();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('/');
    expect(searchBox()).toHaveFocus();
    await user.keyboard('wand');
    expect(searchBox()).toHaveValue('wand');
    await user.keyboard('{Escape}');
    expect(searchBox()).toHaveValue('');
  });

  it('choosing a category tab leaves search mode', async () => {
    const { user } = await asOwner();
    await user.type(searchBox(), 'wand');
    await user.click(screen.getByRole('tab', { name: categoryName(fitness.label) }));
    expect(searchBox()).toHaveValue('');
    expect(screen.getByRole('tablist', { name: /Unterbereiche/ })).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('signed in: learned / remaining / percent and per-category progress from real data', async () => {
    const { user } = await signedIn();
    await user.click(screen.getByRole('checkbox', { name: `یادگرفتم: ${AUSSENWAND.word}` }));
    await user.click(link('پیشرفت'));
    expect(screen.getByTestId('db-learned')).toHaveTextContent('1');
    expect(screen.getByTestId('db-remaining')).toHaveTextContent('998');
    expect(screen.getByTestId('db-percent')).toHaveTextContent('0%');
    const archTotal = repo.categories[0]!.subtabs.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.entries.length, 0), 0);
    const archButton = screen.getByRole('button', { name: new RegExp(`Architecture: 1 از ${archTotal} یادگرفته`) });
    expect(screen.getByTestId('db-sync')).toHaveTextContent('پیشرفت همگام با حساب شما');
    expect(screen.getByTestId('db-local')).toHaveTextContent('هنوز تمرینی روی این دستگاه ثبت نشده است');
    expect(screen.getByTestId('db-local')).toHaveTextContent('فقط روی همین مرورگر ذخیره می‌شود');

    await user.click(archButton);
    expect(window.location.hash).toBe('#/');
    expect(screen.getByRole('tab', { name: categoryName(repo.categories[0]!.label) })).toHaveAttribute('aria-selected', 'true');
  });

  it('local practice statistics appear once there is real flashcard data', async () => {
    const { user } = await signedIn();
    await user.click(link('مرور'));
    await user.selectOptions(screen.getByLabelText('تعداد کارت در جلسه'), '10');
    await user.click(screen.getByRole('button', { name: 'شروع مرور (10 کارت)' }));
    await user.click(screen.getByRole('button', { name: /بلد نیستم/ }));
    await user.click(link('پیشرفت'));
    await waitFor(() => expect(screen.getByTestId('db-reviewed')).toHaveTextContent('1'));
    expect(screen.getByTestId('db-shadow-sessions')).toHaveTextContent('0');
  });

  it('quick access opens flashcards and shadowing', async () => {
    const { user } = await asOwner();
    await user.click(link('پیشرفت'));
    await user.click(screen.getByRole('button', { name: /مرور با فلش‌کارت/ }));
    expect(window.location.hash).toBe('#/review');
    await user.click(link('پیشرفت'));
    await user.click(screen.getByRole('button', { name: /تمرین تلفظ/ }));
    expect(window.location.hash).toBe('#/shadowing');
  });
});

describe('offline state', () => {
  it('shows an offline banner while the browser has no network', async () => {
    await asOwner();
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    const onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')!;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    try {
      act(() => { window.dispatchEvent(new Event('offline')); });
      expect(screen.getByTestId('offline-banner')).toHaveTextContent('آفلاین هستید');
      expect(screen.getByTestId('offline-banner')).toHaveTextContent('پس از اتصال همگام می‌شوند');
    } finally {
      Object.defineProperty(Navigator.prototype, 'onLine', onLine);
      act(() => { window.dispatchEvent(new Event('online')); });
    }
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});

describe('regression: practice sections keep working inside the new navigation', () => {
  it('a flashcard session survives switching to search and back', async () => {
    const { user } = await asOwner();
    await user.click(link('مرور'));
    await user.selectOptions(screen.getByLabelText('تعداد کارت در جلسه'), '10');
    await user.click(screen.getByRole('button', { name: 'شروع مرور (10 کارت)' }));
    await user.click(screen.getByRole('button', { name: /بلدم/ }));
    await user.click(link('واژه‌ها'));
    fireEvent.change(searchBox(), { target: { value: 'wand' } });
    await user.click(link('مرور'));
    expect(screen.getByTestId('fc-count')).toHaveTextContent('2 / 10');
  });
});
