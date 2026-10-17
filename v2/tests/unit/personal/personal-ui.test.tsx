import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { fakeSpeech, mockMatchMedia, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE, BOB } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';

beforeEach(() => mockMatchMedia(() => false));

type User = ReturnType<typeof userEvent.setup>;
const link = (name: string) => screen.getByRole('link', { name }); // string names match exactly
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const cards = () => [...document.querySelectorAll('article[data-personal-id]')] as HTMLElement[];
const card = (word: string) => cards().find((c) => c.getAttribute('aria-label') === word)!;

async function signedIn(env = createFakeServices({ restored: ALICE }), speech = fakeSpeech()) {
  const user = userEvent.setup();
  const view = render(<App services={env.services} speechService={speech} />);
  await waitForLearnedCheckboxes();
  return { user, env, view, speech };
}

async function openMine(user: User) {
  await user.click(link('واژه‌های من'));
  await screen.findByRole('heading', { name: /^واژه‌های من/ });
}

async function addWord(user: User, f: { type?: string; article?: string; lemma: string; fa: string; example?: string; category?: string }) {
  await user.click(button('+ افزودن واژه'));
  const dialog = screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
  const q = within(dialog);
  if (f.type) await user.selectOptions(q.getByLabelText('نوع واژه'), f.type);
  if (f.article) await user.selectOptions(q.getByLabelText('حرف تعریف'), f.article);
  await user.type(q.getByLabelText(/واژه یا عبارت آلمانی/), f.lemma);
  await user.type(q.getByLabelText(/معنی فارسی/), f.fa);
  if (f.example) await user.type(q.getByLabelText(/جملهٔ مثال آلمانی/), f.example);
  if (f.category) await user.selectOptions(q.getByLabelText(/نمایش در دسته/), f.category);
  await user.click(q.getByRole('button', { name: 'افزودن واژه' }));
}

describe('my vocabulary — access', () => {
  it('signed out: explains that personal words need an account', async () => {
    const user = userEvent.setup();
    render(<App services={createFakeServices().services} speechService={fakeSpeech()} />);
    await user.click(link('واژه‌های من'));
    expect(screen.getByText('برای ساختن فهرست واژه‌های خودتان وارد حساب شوید')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ افزودن واژه' })).toBeNull();
  });
});

describe('my vocabulary — create, validate, edit, delete', () => {
  it('validation messages per field, focus on the first error, nothing saved', async () => {
    const { user, env } = await signedIn();
    await openMine(user);
    expect(screen.getByText('هنوز واژه‌ای اضافه نکرده‌اید')).toBeInTheDocument();
    await user.click(button('+ افزودن واژه'));
    const dialog = screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
    await user.click(within(dialog).getByRole('button', { name: 'افزودن واژه' }));
    const lemma = within(dialog).getByLabelText(/واژه یا عبارت آلمانی/);
    expect(lemma).toHaveAttribute('aria-invalid', 'true');
    expect(lemma).toHaveAccessibleDescription('واژهٔ آلمانی را وارد کنید.');
    expect(within(dialog).getByLabelText(/معنی فارسی/)).toHaveAccessibleDescription('معنی فارسی را وارد کنید.');
    await waitFor(() => expect(lemma).toHaveFocus());
    expect(lemma).toHaveAttribute('dir', 'ltr');
    expect(within(dialog).getByLabelText(/معنی فارسی/)).toHaveAttribute('dir', 'rtl');
    await user.type(lemma, 'دیوار');
    expect(lemma).toHaveAccessibleDescription(/واژهٔ آلمانی را بنویسید/);
    await user.click(within(dialog).getByRole('button', { name: 'انصراف' }));
    expect(await env.local.loadPersonalWords(ALICE.uid)).toEqual([]);
  });

  it('adds a noun (article from the text), warns about a duplicate, edits it, deletes with confirmation and undo', async () => {
    const { user, env } = await signedIn();
    await openMine(user);
    await user.click(button('+ افزودن واژه'));
    const dialog = screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
    await user.type(within(dialog).getByLabelText(/واژه یا عبارت آلمانی/), 'die Aussenwand');
    expect(within(dialog).getByRole('status')).toHaveTextContent('این واژه از قبل وجود دارد');
    expect(within(dialog).getByRole('status')).toHaveTextContent('die Außenwand');
    await user.type(within(dialog).getByLabelText(/معنی فارسی/), 'دیوار بیرونی (یادداشت من)');
    await user.click(within(dialog).getByRole('button', { name: 'افزودن واژه' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card('die Aussenwand')).toHaveTextContent('دیوار بیرونی (یادداشت من)');
    expect(card('die Aussenwand')).toHaveTextContent(/تکراری/);
    expect(screen.getByTestId('pw-storage')).toHaveTextContent('روی همین دستگاه');
    expect(screen.getByTestId('pw-storage')).toHaveTextContent('همگام‌سازی ابری هنوز فعال نیست');
    await waitFor(async () => expect(await env.local.loadPersonalWords(ALICE.uid)).toEqual([expect.objectContaining({ article: 'die', lemma: 'Aussenwand' })]));

    await user.click(within(card('die Aussenwand')).getByRole('button', { name: 'ویرایش die Aussenwand' }));
    const edit = screen.getByRole('dialog', { name: 'ویرایش واژه' });
    const fa = within(edit).getByLabelText(/معنی فارسی/);
    await user.clear(fa);
    await user.type(fa, 'دیوار خارجی');
    await user.click(within(edit).getByRole('button', { name: 'ذخیرهٔ تغییرات' }));
    expect(card('die Aussenwand')).toHaveTextContent('دیوار خارجی');

    await user.click(within(card('die Aussenwand')).getByRole('button', { name: 'حذف die Aussenwand' }));
    const confirm = screen.getByRole('dialog', { name: 'حذف واژه' });
    await user.click(within(confirm).getByRole('button', { name: 'انصراف' }));
    expect(cards()).toHaveLength(1); // nothing deleted without confirmation
    await user.click(within(card('die Aussenwand')).getByRole('button', { name: 'حذف die Aussenwand' }));
    await user.click(within(screen.getByRole('dialog', { name: 'حذف واژه' })).getByRole('button', { name: 'حذف' }));
    expect(cards()).toHaveLength(0);
    await user.click(button('بازگردانی'));
    expect(card('die Aussenwand')).toHaveTextContent('دیوار خارجی');
    await waitFor(async () => expect(await env.local.loadPersonalWords(ALICE.uid)).toHaveLength(1));
  });

  it('filters by text, type and status', async () => {
    const { user } = await signedIn();
    await openMine(user);
    await addWord(user, { lemma: 'die Probewand', fa: 'دیوار آزمایشی' });
    await addWord(user, { type: 'v', lemma: 'probieren', fa: 'امتحان کردن' });
    await user.click(within(card('probieren')).getByRole('checkbox'));
    expect(screen.getByTestId('pw-count')).toHaveTextContent('2 از 2');
    await user.type(screen.getByRole('searchbox', { name: 'جستجو در واژه‌های من' }), 'آزمایشی');
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['die Probewand']);
    await user.clear(screen.getByRole('searchbox', { name: 'جستجو در واژه‌های من' }));
    await user.selectOptions(screen.getByLabelText('نوع واژه'), 'v');
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['probieren']);
    await user.selectOptions(screen.getByLabelText('نوع واژه'), 'all');
    await user.selectOptions(screen.getByLabelText('وضعیت'), 'unlearned');
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['die Probewand']);
  });
});

describe('my vocabulary — persistence and isolation', () => {
  it('survives a reload and is never shown to another account', async () => {
    const env = createFakeServices({ restored: ALICE });
    const first = await signedIn(env);
    await openMine(first.user);
    await addWord(first.user, { lemma: 'der Probebalken', fa: 'تیر آزمایشی' });
    await waitFor(async () => expect(await env.local.loadPersonalWords(ALICE.uid)).toHaveLength(1));
    first.view.unmount();

    const again = await signedIn(env); // same device storage: a "reload"
    await openMine(again.user);
    expect(card('der Probebalken')).toBeInTheDocument();

    act(() => env.auth.switchUserExternally(BOB));
    await waitFor(() => expect(screen.getByText('هنوز واژه‌ای اضافه نکرده‌اید')).toBeInTheDocument());
    expect(cards()).toHaveLength(0);
    expect(await env.local.loadPersonalWords(BOB.uid)).toEqual([]);
  });

  it('works offline (local-first): adding needs no network', async () => {
    const { user, env } = await signedIn();
    const onLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')!;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    try {
      act(() => { window.dispatchEvent(new Event('offline')); });
      await openMine(user);
      await addWord(user, { lemma: 'offline', type: 'a', fa: 'بدون اینترنت' });
      expect(card('offline')).toBeInTheDocument();
      await waitFor(async () => expect(await env.local.loadPersonalWords(ALICE.uid)).toHaveLength(1));
      expect(env.cloud.writeLog).toEqual([]);
    } finally {
      Object.defineProperty(Navigator.prototype, 'onLine', onLine);
      act(() => { window.dispatchEvent(new Event('online')); });
    }
  });
});

describe('my vocabulary — learning tools', () => {
  it('search finds personal words; "show in list" opens my words at the word', async () => {
    const { user } = await signedIn();
    await openMine(user);
    await addWord(user, { lemma: 'die Probewortigkeit', fa: 'واژهٔ آزمایشی', example: 'Die Probewortigkeit ist neu.' });
    await user.click(link('واژه‌ها'));
    await user.type(screen.getByRole('searchbox', { name: 'جستجوی واژه' }), 'probewortigkeit');
    const result = await screen.findByRole('article', { name: 'die Probewortigkeit' });
    expect(result).toHaveTextContent('⭐ واژه‌های من');
    await user.click(within(result).getByRole('button', { name: 'نمایش در فهرست' }));
    expect(link('واژه‌های من')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(card('die Probewortigkeit')).toHaveFocus());
  });

  it('a placed word appears in its category as "Meine Wörter", and its checkbox stays local', async () => {
    const { user, env } = await signedIn();
    await openMine(user);
    await addWord(user, { lemma: 'die Probewand', fa: 'دیوار آزمایشی', category: 'arch' });
    await user.click(link('واژه‌ها'));
    expect(screen.getByRole('rowheader', { name: 'die Probewand' })).toBeInTheDocument();
    expect(screen.getByText('Meine Wörter · واژه‌های من')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'یادگرفتم: die Probewand' });
    await user.click(box);
    expect(box).toBeChecked();
    await waitFor(async () => expect((await env.local.loadPersonalWords(ALICE.uid))[0]!.learned).toBe(true));
    expect(env.cloud.writeLog).toEqual([]); // personal ids never go to Firestore progress
    expect(screen.getByTestId('header-progress')).toHaveTextContent('0/999'); // the 999 stay separate
  });

  it('flashcards: "my words" scope, and "know" marks the personal word learned locally', async () => {
    const { user, env } = await signedIn();
    await openMine(user);
    await addWord(user, { lemma: 'die Probewortigkeit', fa: 'واژهٔ آزمایشی' });
    await user.click(link('مرور'));
    await user.selectOptions(screen.getByLabelText('دسته'), 'mine');
    await user.click(button('شروع مرور (1 کارت)'));
    expect(screen.getByTestId('flashcard')).toHaveTextContent('die Probewortigkeit');
    await user.click(button(/بلدم/));
    await waitFor(async () => expect((await env.local.loadPersonalWords(ALICE.uid))[0]!.learned).toBe(true));
    expect(env.cloud.writeLog).toEqual([]);
    await user.click(link('پیشرفت'));
    expect(screen.getByTestId('db-personal')).toHaveTextContent('1 واژهٔ شخصی، 1 یادگرفته');
  });

  it('shadowing: "my words" chip plays the personal word', async () => {
    const { user, speech } = await signedIn();
    await openMine(user);
    await addWord(user, { lemma: 'die Probewortigkeit', fa: 'واژهٔ آزمایشی' });
    await user.click(link('تلفظ'));
    await user.click(button('هیچ‌کدام'));
    await user.click(screen.getByRole('checkbox', { name: /واژه‌های من/ }));
    await user.click(button('شروع تمرین (1 واژه)'));
    expect(speech.speak).toHaveBeenLastCalledWith('die Probewortigkeit', expect.anything());
  });
});

describe('my vocabulary — legacy import', () => {
  const legacyWords = [
    { id: 'cw1712345678901', main: 'arch', tab: 'bau', word: 'die Probewortigkeit', sentence: '', type: 'n', fa: 'واژهٔ آزمایشی', ex: '', exFa: '', pr: '', status: 'ready', checked: true },
    { id: 'cw1712345678902', main: 'arch', tab: 'bau', word: 'die Außenwand', sentence: '', type: 'n', fa: 'دیوار', ex: '', exFa: '', pr: '', status: 'ready', checked: false },
    { id: 'cw1712345678903', main: 'x', tab: 'y', word: '<b>Zukunft</b>', sentence: 'Die Zukunft.', type: 'x', fa: '', ex: '', exFa: '', pr: '', status: 'pending', checked: false },
  ];

  it('preview first, import once (idempotent), legacy data untouched, HTML stays text', async () => {
    const raw = JSON.stringify(legacyWords);
    localStorage.setItem('dvok5_custom', raw);
    const { user, env } = await signedIn();
    await openMine(user);
    await user.click(button('انتقال از نسخهٔ قدیمی'));
    const dialog = await screen.findByRole('dialog', { name: 'انتقال واژه‌های شخصی از نسخهٔ قدیمی' });
    const preview = within(dialog).getByTestId('pw-import-preview');
    expect(within(preview).getByTestId('pw-import-new')).toHaveTextContent('2');
    expect(preview).toHaveTextContent('تکراری با واژه‌های داخلی: 1');
    expect(await env.local.loadPersonalWords(ALICE.uid)).toEqual([]); // nothing written before confirming
    await user.click(within(dialog).getByRole('button', { name: 'انتقال 2 واژه' }));
    expect(await within(dialog).findByText(/2 واژه به «واژه‌های من» اضافه شد/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'بستن' }));

    expect(cards().map((c) => c.getAttribute('aria-label')).sort()).toEqual(['<b>Zukunft</b>', 'die Probewortigkeit']);
    expect(document.querySelector('article b')).toBeNull(); // rendered as text, not HTML
    expect(card('<b>Zukunft</b>')).toHaveTextContent('ناقص');
    expect(localStorage.getItem('dvok5_custom')).toBe(raw);

    await user.click(button('انتقال از نسخهٔ قدیمی'));
    const again = await screen.findByRole('dialog', { name: 'انتقال واژه‌های شخصی از نسخهٔ قدیمی' });
    expect(within(again).getByTestId('pw-import-new')).toHaveTextContent('0');
    expect(again).toHaveTextContent('قبلاً منتقل شده: 2');
    expect(within(again).getByRole('button', { name: 'واژه‌ای برای انتقال نیست' })).toBeDisabled();
  });
});
