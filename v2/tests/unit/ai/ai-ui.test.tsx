import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { fakeSpeech, mockMatchMedia, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { createFakeAi, NACHHALTIGKEIT } from '../../helpers/fakeAi';
import { storedWords } from '../../helpers/personal';

beforeEach(() => mockMatchMedia(() => false));

type User = ReturnType<typeof userEvent.setup>;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

async function setup(withAi = true) {
  const ai = createFakeAi();
  const env = createFakeServices({ restored: ALICE, ...(withAi ? { ai } : {}) });
  const user = userEvent.setup();
  render(<App services={env.services} speechService={fakeSpeech()} />);
  await waitForLearnedCheckboxes();
  await user.click(screen.getByRole('link', { name: 'واژه‌های من' }));
  await screen.findByRole('heading', { name: /^واژه‌های من/ });
  return { user, env, ai };
}

const review = () => within(screen.getByTestId('ai-review'));
const rowCheckbox = (field: string) => document.querySelector<HTMLInputElement>(`tr[data-field="${field}"] input[type="checkbox"]`)!;

async function addManually(user: User, lemma: string, fa: string) {
  await user.click(button('افزودن واژه'));
  const d = within(screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' }));
  await user.type(d.getByLabelText(/واژه یا عبارت آلمانی/), lemma);
  await user.type(d.getByRole('textbox', { name: 'معنی فارسی' }), fa);
  await user.click(d.getByRole('button', { name: 'افزودن واژه' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('AI suggestions — new word', () => {
  it('generates from a German word, shows the review, fills the form only after "apply", saves only on "save"', async () => {
    const { user, env, ai } = await setup();
    await user.click(button('افزودن با هوش مصنوعی'));
    const dialog = within(screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' }));
    const aiWord = dialog.getByLabelText('واژهٔ آلمانی برای پیشنهاد');
    expect(aiWord).toHaveFocus();
    await user.type(aiWord, 'nachhaltigkeit');
    await user.type(dialog.getByLabelText(/جمله‌ای که واژه را در آن دیدید/), 'Nachhaltigkeit ist wichtig.');
    ai.willSuggest(NACHHALTIGKEIT);
    await user.click(dialog.getByRole('button', { name: 'دریافت پیشنهاد' }));
    await screen.findByTestId('ai-review');
    expect(ai.calls).toEqual([{ mode: 'from-german', word: 'nachhaltigkeit', context: 'Nachhaltigkeit ist wichtig.' }]);
    expect(review().getByText(/پیشنهاد هوش مصنوعی — ممکن است اشتباه باشد/)).toBeInTheDocument();
    expect(review().getByText('پایداری')).toBeInTheDocument();
    // Nothing in the form or storage yet.
    expect(dialog.getByRole('textbox', { name: 'معنی فارسی' })).toHaveValue('');
    expect(rowCheckbox('fa')).toBeChecked();
    await user.click(rowCheckbox('pronunciationFa')); // user leaves pronunciation out
    await user.click(review().getByRole('button', { name: /^قرار دادن .* فیلد در فرم$/ }));
    expect(dialog.getByLabelText(/واژه یا عبارت آلمانی/)).toHaveValue('Nachhaltigkeit');
    expect(dialog.getByLabelText('حرف تعریف')).toHaveValue('die');
    expect(dialog.getByRole('textbox', { name: 'معنی فارسی' })).toHaveValue('پایداری');
    expect(dialog.getByLabelText(/جملهٔ مثال آلمانی/)).toHaveValue(NACHHALTIGKEIT.example);
    expect(dialog.getByLabelText(/تلفظ به خط فارسی/)).toHaveValue('');
    expect(dialog.getByText(/تا «ذخیره» را نزنید چیزی ذخیره نمی‌شود/)).toBeInTheDocument();
    expect(await storedWords(env.local, ALICE.uid)).toEqual([]);

    await user.click(dialog.getByRole('button', { name: 'افزودن واژه' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const saved = await storedWords(env.local, ALICE.uid);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ article: 'die', lemma: 'Nachhaltigkeit', fa: 'پایداری', pronunciationFa: '', source: 'manual' });
    expect(document.querySelector('article[aria-label="die Nachhaltigkeit"]')).not.toBeNull();
  });

  it('never overwrites what the user typed unless explicitly ticked; Persian → German mode', async () => {
    const { user, ai } = await setup();
    await user.click(button('افزودن واژه'));
    const dialog = within(screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' }));
    await user.type(dialog.getByRole('textbox', { name: 'معنی فارسی' }), 'دوام');
    await user.click(dialog.getByLabelText('از معنی فارسی'));
    const faInput = dialog.getByLabelText('معنی فارسی برای یافتن واژهٔ آلمانی');
    expect(faInput).toHaveValue('دوام');
    await user.clear(faInput);
    await user.type(faInput, 'پایداری');
    ai.willSuggest(NACHHALTIGKEIT);
    await user.click(dialog.getByRole('button', { name: 'دریافت پیشنهاد' }));
    await screen.findByTestId('ai-review');
    expect(ai.calls[0]).toEqual({ mode: 'from-persian', fa: 'پایداری' });
    expect(rowCheckbox('fa')).not.toBeChecked();
    expect(document.querySelector('tr[data-field="fa"]')).toHaveTextContent('جایگزینِ مقدار شما');
    await user.click(review().getByRole('button', { name: /^قرار دادن/ }));
    expect(dialog.getByRole('textbox', { name: 'معنی فارسی' })).toHaveValue('دوام'); // kept
    expect(dialog.getByLabelText(/واژه یا عبارت آلمانی/)).toHaveValue('Nachhaltigkeit');
  });

  it('shows errors in Persian, a mock label for the local provider, and can be cancelled', async () => {
    const { user, ai } = await setup();
    await user.click(button('افزودن با هوش مصنوعی'));
    const dialog = within(screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' }));
    await user.type(dialog.getByLabelText('واژهٔ آلمانی برای پیشنهاد'), 'Wand');
    ai.willFail('daily-limit');
    await user.click(dialog.getByRole('button', { name: 'دریافت پیشنهاد' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('سهم امروز شما از پیشنهادهای هوش مصنوعی تمام شده است');

    const release = ai.holdNext();
    ai.willSuggest(NACHHALTIGKEIT);
    await user.click(dialog.getByRole('button', { name: 'دریافت پیشنهاد' }));
    expect(dialog.getByRole('button', { name: 'در حال دریافت پیشنهاد…' })).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: 'لغو' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'دریافت پیشنهاد' })).toBeEnabled());
    expect(screen.queryByTestId('ai-review')).toBeNull();
    release();

    ai.willSuggest({ ...NACHHALTIGKEIT, fa: '[آزمایشی] معنی' }, { mock: true });
    await user.click(dialog.getByRole('button', { name: 'دریافت پیشنهاد' }));
    expect(await screen.findByText(/پیشنهاد آزمایشی — از سرویس محلیِ بدون هوش مصنوعی واقعی/)).toBeInTheDocument();
  });
});

describe('AI suggestions — complete an existing word', () => {
  it('«✨ تکمیل» asks only for the empty fields, keeps the saved values, and saves after review', async () => {
    const { user, env, ai } = await setup();
    await addManually(user, 'die Fassadenplatte', 'پنل نما');
    const card = document.querySelector<HTMLElement>('article[aria-label="die Fassadenplatte"]')!;
    ai.willSuggest({ article: 'die', lemma: 'Fassadenplatte', type: 'n', grammar: 'Plural: die Fassadenplatten', fa: 'صفحهٔ نما',
      example: 'Die Fassadenplatte wird verschraubt.', exampleFa: 'صفحهٔ نما پیچ می‌شود.', pronunciationFa: 'دی فاسادن‌پلاته' });
    await user.click(within(card).getByRole('button', { name: 'تکمیل die Fassadenplatte با هوش مصنوعی' }));
    const dialog = within(screen.getByRole('dialog', { name: 'ویرایش واژه' }));
    await screen.findByTestId('ai-review');
    expect(ai.calls[0]).toMatchObject({ mode: 'complete', existing: { lemma: 'Fassadenplatte', article: 'die', type: 'n', fa: 'پنل نما', example: '' } });
    expect(rowCheckbox('fa')).not.toBeChecked(); // the saved meaning is not replaced
    expect(rowCheckbox('example')).toBeChecked();
    await user.click(review().getByRole('button', { name: /^قرار دادن/ }));
    await user.click(dialog.getByRole('button', { name: 'ذخیرهٔ تغییرات' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [w] = await storedWords(env.local, ALICE.uid);
    expect(w).toMatchObject({ fa: 'پنل نما', example: 'Die Fassadenplatte wird verschraubt.', grammar: 'Plural: die Fassadenplatten', source: 'manual' });
    // Complete now → no «✨ تکمیل» any more.
    expect(within(document.querySelector<HTMLElement>('article[aria-label="die Fassadenplatte"]')!).queryByRole('button', { name: /تکمیل/ })).toBeNull();
  });

  it('closing the form after a suggestion changes nothing', async () => {
    const { user, env, ai } = await setup();
    await addManually(user, 'die Dachrinne', 'ناودان');
    ai.willSuggest({ ...NACHHALTIGKEIT, lemma: 'Dachrinne', fa: 'آبرو' });
    await user.click(button('تکمیل die Dachrinne با هوش مصنوعی'));
    await screen.findByTestId('ai-review');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'انصراف' }));
    const [w] = await storedWords(env.local, ALICE.uid);
    expect(w).toMatchObject({ lemma: 'Dachrinne', fa: 'ناودان', example: '' });
  });
});

describe('AI not configured', () => {
  it('no AI buttons; the form explains it and manual entry works', async () => {
    const { user } = await setup(false);
    expect(screen.queryByRole('button', { name: 'افزودن با هوش مصنوعی' })).toBeNull();
    await addManually(user, 'die Traufe', 'لبهٔ بام');
    expect(screen.queryByRole('button', { name: /تکمیل .* با هوش مصنوعی/ })).toBeNull();
    await user.click(button('ویرایش die Traufe'));
    expect(within(screen.getByRole('dialog')).getByText(/پیشنهاد با هوش مصنوعی در این نسخه فعال نیست/)).toBeInTheDocument();
  });
});
