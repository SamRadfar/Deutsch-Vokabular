// Categories through the real app UI: the shared destination picker in «افزودن واژه», the words
// browser (new main tab / sub tabs), and «مدیریت دسته‌بندی‌ها» (create, duplicate, sub in a
// built-in category, rename keeps the id, delete without losing words, move words).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { fakeSpeech, mockMatchMedia, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { storedCategories, storedWords } from '../../helpers/personal';

beforeEach(() => mockMatchMedia(() => false));

type User = ReturnType<typeof userEvent.setup>;
const link = (name: string) => screen.getByRole('link', { name });
const button = (name: string | RegExp) => screen.getByRole('button', { name });

async function signedIn() {
  const env = createFakeServices({ restored: ALICE });
  const user = userEvent.setup();
  render(<App services={env.services} speechService={fakeSpeech()} />);
  await waitForLearnedCheckboxes();
  await user.click(link('واژه‌های من'));
  await screen.findByRole('heading', { name: /^واژه‌های من/ });
  return { user, env };
}

async function fillWord(user: User, lemma: string, fa: string) {
  await user.click(button('افزودن واژه'));
  const dialog = screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
  const q = within(dialog);
  await user.type(q.getByLabelText(/واژه یا عبارت آلمانی/), lemma);
  await user.type(q.getByLabelText(/معنی فارسی/), fa);
  return q;
}

const mainRow = (name: string) => screen.getAllByTestId('catm-main').find((li) => li.querySelector('.catm__name')?.textContent === name)!;

describe('category destination in «افزودن واژه»', () => {
  it('a new main category with a first subcategory is created only on save, then appears as tabs', async () => {
    const { user, env } = await signedIn();
    // Cancel: nothing is created.
    let q = await fillWord(user, 'der Koffer', 'چمدان');
    await user.click(q.getByRole('radio', { name: 'دسته اصلی جدید' }));
    await user.type(q.getByLabelText('نام دسته اصلی جدید'), 'Reisen');
    await user.click(q.getByRole('button', { name: 'انصراف' }));
    expect(await storedCategories(env.local, ALICE.uid)).toEqual([]);

    q = await fillWord(user, 'der Koffer', 'چمدان');
    await user.click(q.getByRole('radio', { name: 'دسته اصلی جدید' }));
    await user.type(q.getByLabelText('نام دسته اصلی جدید'), 'Reisen');
    await user.type(q.getByLabelText('نخستین زیرمجموعه (اختیاری)'), 'Gepäck');
    await user.click(q.getByRole('button', { name: 'افزودن واژه' }));
    await waitFor(async () => expect(await storedWords(env.local, ALICE.uid)).toHaveLength(1));
    const cats = await storedCategories(env.local, ALICE.uid);
    const main = cats.find((c) => c.parentId === null)!;
    const sub = cats.find((c) => c.parentId === main.id)!;
    expect([main.name, sub.name]).toEqual(['Reisen', 'Gepäck']);
    expect((await storedWords(env.local, ALICE.uid))[0]!.placement).toEqual({ category: main.id, subtab: sub.id });
    expect(document.querySelector('article[data-personal-id]')).toHaveTextContent('Reisen › Gepäck');

    // A second word: «افزودن به دسته موجود» lists the new category; a duplicate new main is refused.
    q = await fillWord(user, 'das Ticket', 'بلیت');
    await user.click(q.getByRole('radio', { name: 'دسته اصلی جدید' }));
    await user.type(q.getByLabelText('نام دسته اصلی جدید'), ' reisen ');
    expect(q.getByTestId('category-destination-error')).toHaveTextContent('وجود دارد');
    await user.click(q.getByRole('radio', { name: 'افزودن به دسته موجود' }));
    await user.selectOptions(q.getByLabelText('دسته اصلی'), main.id);
    await user.click(q.getByRole('button', { name: 'افزودن واژه' }));
    await waitFor(async () => expect(await storedWords(env.local, ALICE.uid)).toHaveLength(2));
    expect(await storedCategories(env.local, ALICE.uid)).toHaveLength(2); // no duplicate

    // The words browser: a main tab with the subcategory tab and a "directly in the main" tab.
    await user.click(link('واژه‌ها'));
    await user.click(screen.getByRole('tab', { name: 'Reisen' }));
    expect(screen.getByRole('tab', { name: /Gepäck/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('rowheader', { name: 'der Koffer' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Meine Wörter/ }));
    expect(screen.getByRole('rowheader', { name: 'das Ticket' })).toBeInTheDocument();
    // Search shows the word with its own category, and the category filter offers it.
    await user.type(screen.getByRole('searchbox'), 'Koffer');
    await waitFor(() => expect(document.querySelector('.sres__crumb')).toHaveTextContent('Reisen › Gepäck'));
    expect(screen.getByRole('option', { name: 'Reisen' })).toBeInTheDocument();
    // Progress: own categories with their counts, opening the tab from there.
    await user.click(link('پیشرفت'));
    const own = await screen.findByTestId('db-own-categories');
    expect(own).toHaveTextContent('Reisen');
    expect(own).toHaveTextContent('0/2');
    await user.click(within(own).getByRole('button', { name: /^Reisen/ }));
    expect(screen.getByRole('tab', { name: 'Reisen' })).toHaveAttribute('aria-selected', 'true');
  }, 40_000);

  it('a subcategory inside a BUILT-IN category; the library stays unchanged', async () => {
    const { user, env } = await signedIn();
    const q = await fillWord(user, 'der Brettschichtholzträger', 'تیر چوبی چندلایه');
    await user.click(q.getByRole('radio', { name: 'ساخت زیرمجموعه در دسته موجود' }));
    await user.selectOptions(q.getByLabelText('در دسته اصلی'), 'arch');
    await user.type(q.getByLabelText('نام زیرمجموعهٔ جدید'), 'Holzbau');
    await user.click(q.getByRole('button', { name: 'افزودن واژه' }));
    await waitFor(async () => expect(await storedWords(env.local, ALICE.uid)).toHaveLength(1));
    const [sub] = await storedCategories(env.local, ALICE.uid);
    expect(sub).toMatchObject({ name: 'Holzbau', parentId: 'arch' });
    await user.click(link('واژه‌ها'));
    await user.click(screen.getByRole('tab', { name: /Holzbau/ }));
    expect(screen.getByRole('rowheader', { name: 'der Brettschichtholzträger' })).toBeInTheDocument();
    expect(screen.getByTestId('header-progress')).toHaveTextContent('0/999'); // the library is untouched
  }, 30_000);
});

describe('«مدیریت دسته‌بندی‌ها»', () => {
  it('create, duplicate refused, sub in a built-in main, rename keeps the id, delete keeps the words', async () => {
    const { user, env } = await signedIn();
    // One word in a new category first.
    const q = await fillWord(user, 'das Visum', 'ویزا');
    await user.click(q.getByRole('radio', { name: 'دسته اصلی جدید' }));
    await user.type(q.getByLabelText('نام دسته اصلی جدید'), 'Reisen');
    await user.click(q.getByRole('button', { name: 'افزودن واژه' }));
    await waitFor(async () => expect(await storedWords(env.local, ALICE.uid)).toHaveLength(1));

    await user.click(screen.getByTestId('open-categories'));
    const dialog = await screen.findByRole('dialog', { name: 'مدیریت دسته‌بندی‌ها' });
    const m = within(dialog);
    // Built-in categories are listed but locked (no rename/delete).
    const arch = m.getAllByTestId('catm-main').find((li) => li.getAttribute('data-id') === 'arch')!;
    expect(within(arch).queryByRole('button', { name: /^حذف/ })).toBeNull();
    expect(within(arch).queryByRole('button', { name: /^تغییر نام/ })).toBeNull();

    await user.type(m.getByLabelText('دسته اصلی جدید'), 'Essen');
    await user.click(m.getByRole('button', { name: 'ساخت دسته' }));
    expect(m.getByTestId('catm-notice')).toHaveTextContent('Essen');
    await user.type(m.getByLabelText('دسته اصلی جدید'), 'ESSEN');
    await user.click(m.getByRole('button', { name: 'ساخت دسته' }));
    expect(m.getByRole('alert')).toHaveTextContent(/وجود دارد|تکراری/);
    await user.clear(m.getByLabelText('دسته اصلی جدید'));

    // A subcategory in the built-in "arch".
    await user.click(within(arch).getByRole('button', { name: 'زیرمجموعه' }));
    await user.type(m.getByLabelText(/نام زیرمجموعهٔ جدید در/), 'Holzbau');
    await user.click(m.getByRole('button', { name: 'ساخت زیرمجموعه' }));
    await waitFor(async () => expect((await storedCategories(env.local, ALICE.uid)).find((c) => c.name === 'Holzbau')?.parentId).toBe('arch'));

    // Rename keeps the id (the word still points to it).
    const before = (await storedCategories(env.local, ALICE.uid)).find((c) => c.name === 'Reisen')!;
    await user.click(within(mainRow('Reisen')).getByRole('button', { name: 'تغییر نام Reisen' }));
    const nameInput = m.getByLabelText('نام تازه');
    await user.clear(nameInput);
    await user.type(nameInput, 'Urlaub');
    await user.click(m.getByRole('button', { name: 'ذخیرهٔ نام' }));
    await waitFor(async () => expect((await storedCategories(env.local, ALICE.uid)).find((c) => c.id === before.id)?.name).toBe('Urlaub'));
    expect(within(mainRow('Urlaub')).getByTestId('catm-count')).toHaveTextContent('1');

    // Delete: confirmation, the word moves to another category (here: "Essen").
    await user.click(within(mainRow('Urlaub')).getByRole('button', { name: 'حذف Urlaub' }));
    const panel = m.getByTestId('catm-panel');
    expect(panel).toHaveTextContent('هیچ واژه‌ای حذف نمی‌شود');
    await user.click(within(panel).getByRole('radio', { name: 'افزودن به دسته موجود' }));
    const essen = (await storedCategories(env.local, ALICE.uid)).find((c) => c.name === 'Essen')!;
    await user.selectOptions(within(panel).getByLabelText('دسته اصلی'), essen.id);
    await user.click(within(panel).getByRole('button', { name: 'حذف دسته' }));
    await waitFor(async () => expect((await storedCategories(env.local, ALICE.uid)).map((c) => c.name).sort()).toEqual(['Essen', 'Holzbau']));
    const [visum] = await storedWords(env.local, ALICE.uid);
    expect(visum).toMatchObject({ lemma: 'Visum', placement: { category: essen.id, subtab: '_' } });

    // Delete "Essen" leaving the word without a category: it stays in «واژه‌های من».
    await user.click(within(mainRow('Essen')).getByRole('button', { name: 'حذف Essen' }));
    await user.click(within(m.getByTestId('catm-panel')).getByRole('button', { name: 'حذف دسته' }));
    await waitFor(async () => expect((await storedWords(env.local, ALICE.uid))[0]!.placement).toBeNull());
    expect(await storedWords(env.local, ALICE.uid)).toHaveLength(1);
  }, 40_000);
});
