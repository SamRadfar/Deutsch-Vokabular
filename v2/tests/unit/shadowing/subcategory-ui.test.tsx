// Shadowing page: main category chips → second row with that category's subcategories (built-in
// and own), combined with «کدام واژه‌ها؟», real counts, empty state, switching, and a session that
// contains ONLY the matching words. Flashcards get the same subcategory filter.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { getBundledRepository } from '../../../src/services/content/bundled';
import { fakeSpeech, mockMatchMedia } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';

const repo = getBundledRepository();
const fitness = repo.getCategory('fitness')!;
const dreame = repo.getCategory('dreame')!;
const subTotal = (i: number) => fitness.subtabs[i]!.groups.reduce((n, g) => n + g.entries.length, 0);
const fitnessTotal = fitness.subtabs.reduce((n, _s, i) => n + subTotal(i), 0);

beforeEach(() => {
  mockMatchMedia(() => false);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const speech = fakeSpeech();
  const env = createFakeServices({ restored: ALICE });
  render(<App services={env.services} speechService={speech} />);
  await vi.waitFor(() => { if (!document.querySelector('input.vchk')) throw new Error('not ready'); }, { timeout: 10_000 });
  return { user, speech, env };
}
const link = (name: string) => screen.getByRole('link', { name });
const chip = (name: string | RegExp) => screen.getByRole('radio', { name });
const subRow = () => screen.getByTestId('sh-subs');
const chipCount = (radio: HTMLElement) => radio.closest('label')!.querySelector('.sh-chip__n, .rv-mode__count')!.textContent;
async function openShadowing(user: ReturnType<typeof userEvent.setup>) {
  await user.click(link('تلفظ'));
  await vi.waitFor(() => expect(chip(/یادنگرفته‌ها/)).toBeEnabled(), { timeout: 5000 });
}

describe('Shadowing — subcategory row', () => {
  it('main chip → its subcategories below; a subcategory filters the session to exactly its words', async () => {
    const { user, speech } = await setup();
    await openShadowing(user);
    // «همهٔ دسته‌ها» is the default: no second row.
    expect(chip(/^همهٔ دسته‌ها/)).toBeChecked();
    expect(screen.queryByTestId('sh-subs')).toBeNull();

    await user.click(chip(/^Fitness/));
    expect(chip(/^Fitness/)).toBeChecked();
    const row = subRow();
    expect(within(row).getByRole('radio', { name: /همه زیرمجموعه‌ها/ })).toBeChecked();
    expect(within(row).getAllByRole('radio').map((r) => r.closest('label')!.querySelector('span')!.textContent))
      .toEqual(['همه زیرمجموعه‌ها', ...fitness.subtabs.map((s) => s.label)]);
    expect(chipCount(within(row).getByRole('radio', { name: /همه زیرمجموعه‌ها/ }))).toBe(String(fitnessTotal));

    // One subcategory: count, session size and the words played.
    const target = fitness.subtabs[1]!;
    const ids = new Set(target.groups.flatMap((g) => g.entries.map((e) => e.word)));
    await user.click(within(row).getByRole('radio', { name: new RegExp(`^${target.label}`) }));
    expect(chipCount(within(row).getByRole('radio', { name: new RegExp(`^${target.label}`) }))).toBe(String(subTotal(1)));
    expect(chipCount(chip(/^همهٔ واژه‌ها/))).toBe(String(subTotal(1))); // «کدام واژه‌ها؟» counts follow the subcategory
    const n = Math.min(subTotal(1), 30);
    await user.click(screen.getByRole('button', { name: `شروع تمرین (${n} واژه)` }));
    await vi.waitFor(() => expect(speech.speak).toHaveBeenCalled());
    expect(ids.has(String(vi.mocked(speech.speak).mock.calls[0]![0]))).toBe(true);
    expect(screen.getByTestId('sh-count').textContent).toContain(String(n));
  });

  it('switching the main category clears the subcategory; «همهٔ دسته‌ها» hides the row; choice is remembered', async () => {
    const { user } = await setup();
    await openShadowing(user);
    await user.click(chip(/^Fitness/));
    await user.click(within(subRow()).getByRole('radio', { name: new RegExp(`^${fitness.subtabs[0]!.label}`) }));
    await user.click(chip(/^Dreame/));
    expect(within(subRow()).getByRole('radio', { name: /همه زیرمجموعه‌ها/ })).toBeChecked();
    expect(within(subRow()).getAllByRole('radio').map((r) => r.closest('label')!.querySelector('span')!.textContent)).toEqual(['همه زیرمجموعه‌ها', ...dreame.subtabs.map((x) => x.label)]);
    await user.click(within(subRow()).getByRole('radio', { name: new RegExp(`^${dreame.subtabs[2]!.label}`) }));
    expect(JSON.parse(localStorage.getItem('dv2.pref.shadowing.v1')!)).toMatchObject({ categories: ['dreame'], subcategory: dreame.subtabs[2]!.id });
    await user.click(chip(/^همهٔ دسته‌ها/));
    expect(screen.queryByTestId('sh-subs')).toBeNull();
  });

  it('combines with «یادگرفته‌ها»: only learned words of that subcategory; empty state when none', async () => {
    const { user, speech } = await setup();
    // Mark ONE word of the second Fitness subcategory learned (words page).
    await user.click(screen.getByRole('tab', { name: /Fitness/ }));
    await user.click(screen.getByRole('tab', { name: new RegExp(fitness.subtabs[1]!.label) }));
    const learnedWord = fitness.subtabs[1]!.groups[0]!.entries[0]!.word;
    await user.click(screen.getByRole('checkbox', { name: `یادگرفتم: ${learnedWord}` }));

    await openShadowing(user);
    await user.click(chip(/^Fitness/));
    await user.click(chip(/^یادگرفته‌ها/));
    // Other subcategory: nothing learned → clear empty state, start disabled.
    await user.click(within(subRow()).getByRole('radio', { name: new RegExp(`^${fitness.subtabs[0]!.label}`) }));
    expect(screen.getByTestId('sh-empty')).toHaveTextContent('واژه‌ای نیست');
    expect(screen.getByRole('button', { name: 'واژه‌ای برای تمرین نیست' })).toBeDisabled();
    // The subcategory with the learned word: exactly 1, even with session size 30.
    await user.click(within(subRow()).getByRole('radio', { name: new RegExp(`^${fitness.subtabs[1]!.label}`) }));
    expect(chipCount(chip(/^یادگرفته‌ها/))).toBe('1');
    await user.click(screen.getByRole('button', { name: 'شروع تمرین (1 واژه)' }));
    await vi.waitFor(() => expect(speech.speak).toHaveBeenCalled());
    expect(vi.mocked(speech.speak).mock.calls[0]![0]).toBe(learnedWord);
  });

  it('own subcategories (also under a built-in category) appear automatically; words directly in a category get their own chip', async () => {
    const { user, speech } = await setup();
    // A personal word in a NEW subcategory of the built-in Fitness category.
    await user.click(link('واژه‌های من'));
    await user.click(await screen.findByRole('button', { name: 'افزودن واژه' }));
    let form = within(screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' }));
    await user.type(form.getByLabelText(/واژه یا عبارت آلمانی/), 'die Faszienrolle');
    await user.type(form.getByRole('textbox', { name: 'معنی فارسی' }), 'فوم رولر');
    await user.click(form.getByRole('radio', { name: 'ساخت زیرمجموعه در دسته موجود' }));
    await user.selectOptions(form.getByLabelText('در دسته اصلی'), 'fitness');
    await user.type(form.getByLabelText('نام زیرمجموعهٔ جدید'), 'Mobilität');
    await user.click(form.getByRole('button', { name: 'افزودن واژه' }));
    // A personal word directly in Fitness (no subcategory).
    await user.click(screen.getByRole('button', { name: 'افزودن واژه' }));
    form = within(screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' }));
    await user.type(form.getByLabelText(/واژه یا عبارت آلمانی/), 'der Pulsgurt');
    await user.type(form.getByRole('textbox', { name: 'معنی فارسی' }), 'کمربند ضربان');
    await user.click(form.getByRole('radio', { name: 'افزودن به دسته موجود' }));
    await user.selectOptions(form.getByLabelText('دسته اصلی'), 'fitness');
    await user.click(form.getByRole('button', { name: 'افزودن واژه' }));

    await openShadowing(user);
    await user.click(chip(/^Fitness/));
    const own = within(subRow()).getByRole('radio', { name: /^Mobilität/ });
    expect(chipCount(own)).toBe('1');
    const direct = within(subRow()).getByRole('radio', { name: /^مستقیم در این دسته/ });
    expect(chipCount(direct)).toBe('1');
    // «همه زیرمجموعه‌ها» = every Fitness word incl. the personal ones.
    expect(chipCount(within(subRow()).getByRole('radio', { name: /همه زیرمجموعه‌ها/ }))).toBe(String(fitnessTotal + 2));
    await user.click(own);
    await user.click(screen.getByRole('button', { name: 'شروع تمرین (1 واژه)' }));
    await vi.waitFor(() => expect(speech.speak).toHaveBeenCalled());
    expect(vi.mocked(speech.speak).mock.calls[0]![0]).toBe('die Faszienrolle');
  }, 40_000);
});

describe('Flashcards — same subcategory filter', () => {
  it('a subcategory select appears for a category and narrows the deck', async () => {
    const { user } = await setup();
    await user.click(link('مرور'));
    await user.selectOptions(await screen.findByLabelText('دسته'), 'all');
    expect(screen.queryByLabelText('زیرمجموعه')).toBeNull();
    await user.selectOptions(screen.getByLabelText('دسته'), 'fitness');
    await user.selectOptions(screen.getByLabelText('زیرمجموعه'), fitness.subtabs[1]!.id);
    const n = subTotal(1);
    expect(screen.getByRole('button', { name: new RegExp(`شروع مرور \\(${Math.min(n, 30)} کارت\\)`) })).toBeEnabled();
    // Changing the category resets the subcategory.
    await user.selectOptions(screen.getByLabelText('دسته'), 'arch');
    expect(screen.getByLabelText('زیرمجموعه')).toHaveValue('');
  });
});
