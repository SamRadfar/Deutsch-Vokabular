// «ساخت واژه با هوش مصنوعی» through the real app UI with a scripted AI client (no network):
// topic → generate → preview/edit/remove → import → new category, practice scopes, no legacy import.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GeneratedEntry } from '../../../ai-worker/src/contract';
import { App } from '../../../src/app/App';
import { fakeSpeech, mockMatchMedia, waitForLearnedCheckboxes } from '../../helpers/dom';
import { createFakeAi } from '../../helpers/fakeAi';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { storedCategories, storedWords } from '../../helpers/personal';

beforeEach(() => mockMatchMedia(() => false));

const E = (lemma: string, fa: string, sub: string, o: Partial<GeneratedEntry> = {}): GeneratedEntry => ({
  article: 'die', lemma, type: 'n', grammar: '', fa, example: `Ich kaufe eine neue ${lemma}.`, exampleFa: 'من یک لباس نو می‌خرم.', subcategory: sub, level: 'A2', ...o,
});
const BATCH = [
  E('Jacke', 'کاپشن', 'Oberbekleidung'),
  E('Hose', 'شلوار', 'Oberbekleidung'),
  E('anprobieren', 'پرو کردن', 'Einkaufen', { type: 'v', article: null, example: 'Kann ich das Kleid anprobieren?' }),
  E('Außenwand', 'دیوار خارجی', 'Sonstiges'), // already in the built-in library → duplicate
];

async function open() {
  const ai = createFakeAi();
  const env = createFakeServices({ restored: ALICE, ai });
  const user = userEvent.setup();
  render(<App services={env.services} speechService={fakeSpeech()} />);
  await waitForLearnedCheckboxes();
  await user.click(screen.getByRole('link', { name: 'واژه‌های من' }));
  await screen.findByRole('heading', { name: /^واژه‌های من/ });
  return { ai, env, user };
}

describe('AI vocabulary generator', () => {
  it('replaces the legacy import, previews, edits, imports into a new category and syncs', async () => {
    const { ai, env, user } = await open();
    expect(screen.queryByRole('button', { name: 'انتقال از نسخهٔ قدیمی' })).toBeNull();
    ai.willGenerate(BATCH);
    ai.useGenerator(() => ({ ok: false, code: 'daily-limit', message: 'سهم امروز شما از هوش مصنوعی تمام شده است؛ فردا دوباره امتحان کنید.' }));

    await user.click(screen.getByTestId('open-generator'));
    const dialog = await screen.findByRole('dialog', { name: 'ساخت واژه با هوش مصنوعی' });
    const q = within(dialog);
    await user.type(q.getByLabelText('موضوع'), 'Kleidung und Mode');
    await user.click(q.getByRole('radio', { name: '25' }));
    await user.click(q.getByRole('radio', { name: 'A1–A2' }));
    await user.click(q.getByRole('button', { name: /ساخت واژه‌ها/ }));

    const preview = await screen.findByTestId('gen-preview');
    expect(ai.generateCalls[0]).toEqual({ topic: 'Kleidung und Mode', level: 'A1-A2', count: 15 });
    expect(await storedWords(env.local, ALICE.uid)).toEqual([]); // nothing saved before confirming
    expect(await storedCategories(env.local, ALICE.uid)).toEqual([]); // no category created by a preview
    const rows = within(preview).getAllByTestId('gen-row');
    expect(rows).toHaveLength(4);
    expect(within(preview).getByTestId('gen-stopped')).toHaveTextContent('فقط 4 از 25 واژه ساخته شد');
    // The duplicate of the built-in "die Außenwand" is flagged and not selected.
    expect(within(rows[3]!).getByTestId('gen-dup')).toHaveTextContent('die Außenwand');
    expect(within(rows[3]!).getByRole('checkbox')).not.toBeChecked();
    expect(within(preview).getByTestId('gen-counts')).toHaveTextContent('3 از 4 انتخاب‌شده');

    // Edit one meaning, remove one row.
    const fa = within(rows[1]!).getByLabelText('معنی فارسی');
    await user.clear(fa);
    await user.type(fa, 'شلوار بلند');
    await user.click(within(rows[2]!).getByRole('button', { name: /^حذف anprobieren/ }));
    expect(within(preview).getAllByTestId('gen-row')).toHaveLength(3);

    await user.click(within(preview).getByTestId('gen-import'));
    await screen.findByTestId('gen-done');
    expect(screen.getByTestId('gen-done')).toHaveTextContent('2 واژه به «واژه‌های من» در دستهٔ «Kleidung und Mode» اضافه شد');
    // A real main category + the AI subcategory of the imported rows only (removed/unselected rows create nothing).
    const cats = await storedCategories(env.local, ALICE.uid);
    const main = cats.find((c) => c.parentId === null)!;
    expect(cats.map((c) => [c.name, c.parentId === null ? null : 'main']).sort()).toEqual([['Kleidung und Mode', null], ['Oberbekleidung', 'main']]);
    const sub = cats.find((c) => c.parentId === main.id)!;
    expect(main.id).toMatch(/^uc_[0-9a-f]{20}$/);
    const saved = await storedWords(env.local, ALICE.uid);
    expect(saved.map((w) => [w.lemma, w.fa, w.placement]).sort()).toEqual([
      ['Hose', 'شلوار بلند', { category: main.id, subtab: sub.id }],
      ['Jacke', 'کاپشن', { category: main.id, subtab: sub.id }],
    ]);
    await user.click(screen.getByRole('button', { name: 'نمایش واژه‌ها' }));
    expect(screen.getByTestId('pw-collection')).toHaveValue(main.id);
    expect(screen.getByTestId('pw-count')).toHaveTextContent('2 از 2');
    expect(document.querySelector('article[data-personal-id]')).toHaveTextContent('Kleidung und Mode › Oberbekleidung');

    // The new category is a practice scope in review.
    await user.click(screen.getByRole('link', { name: 'مرور' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /^Kleidung und Mode \(2\)/ })).toBeInTheDocument());
    // …and a main tab in the words browser, with its subcategory as a tab.
    await user.click(screen.getByRole('link', { name: 'واژه‌ها' }));
    await user.click(screen.getByRole('tab', { name: 'Kleidung und Mode' }));
    expect(screen.getByRole('tab', { name: /Oberbekleidung/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('rowheader', { name: 'die Jacke' })).toBeInTheDocument();
  });

  it('imports into a NEW subcategory of a built-in category and opens it as a tab', async () => {
    const { ai, user } = await open();
    ai.willGenerate([E('Brettschichtholz', 'چوب چندلایه', 'Holz'), E('Holzbalkendecke', 'سقف تیرچوبی', 'Holz')]);
    ai.useGenerator(() => ({ ok: false, code: 'daily-limit', message: 'سهم امروز تمام شد.' }));
    await user.click(screen.getByTestId('open-generator'));
    const dialog = await screen.findByRole('dialog', { name: 'ساخت واژه با هوش مصنوعی' });
    const q = within(dialog);
    await user.type(q.getByLabelText('موضوع'), 'Holzbau');
    await user.click(q.getByRole('radio', { name: '25' }));
    await user.click(q.getByRole('radio', { name: 'ساخت زیرمجموعه در دسته موجود' }));
    await user.selectOptions(q.getByLabelText('در دسته اصلی'), 'arch');
    await user.type(q.getByLabelText('نام زیرمجموعهٔ جدید'), 'Holzbau');
    await user.click(q.getByRole('button', { name: /ساخت واژه‌ها/ }));
    const preview = await screen.findByTestId('gen-preview');
    await user.click(within(preview).getByTestId('gen-import'));
    await user.click(await screen.findByTestId('gen-open-category'));
    // The words browser opens on «Architektur» › «Holzbau» with the imported words.
    expect(screen.getByRole('tab', { name: /Holzbau/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('rowheader', { name: 'die Brettschichtholz' })).toBeInTheDocument();
    expect(screen.getByTestId('header-progress')).toHaveTextContent('0/999');
  }, 40_000);

  it('says honestly when the AI service is not configured (no fake generation)', async () => {
    const env = createFakeServices({ restored: ALICE });
    const user = userEvent.setup();
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitForLearnedCheckboxes();
    await user.click(screen.getByRole('link', { name: 'واژه‌های من' }));
    await user.click(await screen.findByTestId('open-generator'));
    expect(await screen.findByTestId('gen-not-configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ساخت واژه‌ها/ })).toBeDisabled();
  });
});
