import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { speechTextForWord } from '../../../src/features/pronunciation/speechService';
import { fakeSpeech, mockMatchMedia, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { categoryName } from '../../../src/models/vocabulary';

const repo = getVocabularyRepository();
const first = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;

beforeEach(() => mockMatchMedia(() => false));

type User = ReturnType<typeof userEvent.setup>;
const reviewTab = () => screen.getByRole('link', { name: 'مرور' });
const card = () => screen.getByTestId('flashcard');
const currentId = () => card().getAttribute('data-entry-id')!;
const currentEntry = () => repo.getEntry(currentId())!;
const count = () => screen.getByTestId('fc-count').textContent;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const knowBtn = () => button(/بلدم/);
const againBtn = () => button(/بلد نیستم/);

async function openReview(user: User, size: '10' | '20' | '30' | '50' | 'all' = '10') {
  await user.click(reviewTab());
  await user.selectOptions(screen.getByLabelText('تعداد کارت در جلسه'), size);
}

function signedOut() {
  const speech = fakeSpeech();
  const env = createFakeServices();
  render(<App services={env.services} speechService={speech} />);
  return { ...env, speech };
}

async function signedIn() {
  const speech = fakeSpeech();
  const env = createFakeServices({ restored: ALICE });
  render(<App services={env.services} speechService={speech} />);
  await waitForLearnedCheckboxes();
  return { ...env, speech };
}

describe('flashcards — signed out (practice without saving)', () => {
  it('explains that results are not saved; personal modes need sign-in', async () => {
    const user = userEvent.setup();
    signedOut();
    await user.click(reviewTab());
    expect(reviewTab()).toHaveAttribute('aria-current', 'page');
    expect(window.location.hash).toBe('#/review');
    expect(screen.getByRole('note')).toHaveTextContent('نتیجه‌ها ذخیره نمی‌شوند');
    expect(screen.getByRole('radio', { name: /همهٔ واژه‌ها/ })).toBeChecked();
    for (const name of [/یادنگرفته‌ها/, /یادگرفته‌ها/, /مرور دوباره/]) expect(screen.getByRole('radio', { name })).toBeDisabled();
    expect(button('شروع مرور (30 کارت)')).toBeEnabled();
  });

  it('front shows the German word, flipping shows the Persian side and speaks the word', async () => {
    const user = userEvent.setup();
    const { speech } = signedOut();
    await openReview(user);
    await user.click(button('شروع مرور (10 کارت)'));
    const entry = currentEntry();
    expect(count()).toBe('1 / 10');
    expect(card()).toHaveAttribute('data-side', 'front');
    const [front, back] = card().children as unknown as [HTMLElement, HTMLElement];
    expect(within(front).getByText(entry.word)).toBeInTheDocument();
    expect(front).toHaveAttribute('aria-hidden', 'false');
    expect(back).toHaveAttribute('aria-hidden', 'true');
    expect(back).toHaveAttribute('inert');

    await user.click(button('نمایش معنی'));
    expect(card()).toHaveAttribute('data-side', 'back');
    expect(within(back).getByText(entry.fa)).toBeInTheDocument();
    expect(front).toHaveAttribute('inert');
    expect(speech.speak).toHaveBeenLastCalledWith(speechTextForWord(entry.word), expect.anything());

    await user.click(card()); // tapping the card turns it back
    expect(card()).toHaveAttribute('data-side', 'front');
  });

  it('next / previous navigation keeps answers and shows the earlier answer', async () => {
    const user = userEvent.setup();
    signedOut();
    await openReview(user);
    await user.click(button('شروع مرور (10 کارت)'));
    expect(button(/قبلی/)).toBeDisabled();
    const firstId = currentId();
    await user.click(button(/بعدی/));
    expect(count()).toBe('2 / 10');
    await user.click(button(/قبلی/));
    expect(currentId()).toBe(firstId);
    await user.click(knowBtn());
    expect(count()).toBe('2 / 10');
    await user.click(button(/قبلی/));
    expect(screen.getByText('پاسخ شما در این جلسه: بلدم')).toBeInTheDocument();
  });

  it('keyboard: Space flips, arrows navigate, 1/2 answer, S speaks, Esc ends', async () => {
    const user = userEvent.setup();
    const { speech } = signedOut();
    await openReview(user);
    await user.click(button('شروع مرور (10 کارت)'));
    expect(button('نمایش معنی')).toHaveFocus(); // the session starts with focus on the flip control
    (document.activeElement as HTMLElement).blur();

    await user.keyboard(' ');
    expect(card()).toHaveAttribute('data-side', 'back');
    await user.keyboard('{ArrowRight}');
    expect(count()).toBe('2 / 10');
    await user.keyboard('{ArrowLeft}');
    expect(count()).toBe('1 / 10');
    speech.finish(); // the auto-spoken word has ended
    vi.mocked(speech.speak).mockClear();
    await user.keyboard('s');
    expect(speech.speak).toHaveBeenCalledWith(speechTextForWord(currentEntry().word), expect.anything());
    await user.keyboard('2');
    await user.keyboard('1');
    expect(count()).toBe('3 / 10');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    expect(screen.getByTestId('summary-know')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-again')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-unanswered')).toHaveTextContent('8');
    expect(screen.getByText(/نتیجه‌های این جلسه ذخیره نشد/)).toBeInTheDocument();
  });

  it('keys do not fire while typing in a form field', async () => {
    const user = userEvent.setup();
    signedOut();
    await openReview(user);
    await user.click(button('شروع مرور (10 کارت)'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await user.keyboard('2');
    expect(count()).toBe('1 / 10');
    input.remove();
  });

  it('swipe right = know, swipe left = don\'t know; a short drag snaps back; a swipe does not flip', async () => {
    const user = userEvent.setup();
    const { speech } = signedOut();
    await openReview(user);
    await user.click(button('شروع مرور (10 کارت)'));
    const swipe = (dx: number) => {
      const drag = card().parentElement!;
      fireEvent.pointerDown(drag, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 });
      fireEvent.pointerMove(drag, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx / 2, clientY: 202 });
      fireEvent.pointerMove(drag, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx, clientY: 203 });
      fireEvent.pointerUp(drag, { pointerId: 1, pointerType: 'touch', clientX: 200 + dx, clientY: 203 });
      fireEvent.click(card());
    };
    swipe(30);
    expect(count()).toBe('1 / 10');
    expect(card()).toHaveAttribute('data-side', 'front');
    swipe(120);
    expect(count()).toBe('2 / 10');
    expect(card()).toHaveAttribute('data-side', 'front'); // the click ending the swipe did not flip the next card
    swipe(-120);
    expect(count()).toBe('3 / 10');
    expect(card()).toHaveAttribute('data-side', 'front');
    expect(document.querySelector('.fc-tally__know')).toHaveTextContent(/^\s*1$/);
    expect(document.querySelector('.fc-tally__again')).toHaveTextContent(/^\s*1$/);

    // A swipe that starts on the 🔊 button answers and does not play audio; a tap on it does.
    const speak = within(card().firstElementChild as HTMLElement).getAllByRole('button')[0]!;
    const speakCalls = vi.mocked(speech.speak).mock.calls.length;
    fireEvent.pointerDown(speak, { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(speak, { pointerId: 2, pointerType: 'touch', clientX: 160, clientY: 101 });
    fireEvent.pointerMove(speak, { pointerId: 2, pointerType: 'touch', clientX: 230, clientY: 101 });
    fireEvent.pointerUp(speak, { pointerId: 2, pointerType: 'touch', clientX: 230, clientY: 101 });
    fireEvent.click(speak);
    expect(count()).toBe('4 / 10');
    expect(vi.mocked(speech.speak).mock.calls.length).toBe(speakCalls);
    const speakNow = within(card().firstElementChild as HTMLElement).getAllByRole('button')[0]!;
    await user.click(speakNow);
    expect(vi.mocked(speech.speak).mock.calls.length).toBe(speakCalls + 1);
    expect(card()).toHaveAttribute('data-side', 'front');
  });

  it('repeat-review shows the unknown cards again (legacy V3) and restart resets the session', async () => {
    const user = userEvent.setup();
    signedOut();
    await openReview(user);
    await user.click(button('شروع مرور (10 کارت)'));
    const unknown: string[] = [];
    for (let i = 0; i < 10; i++) {
      if (i < 3) { unknown.push(currentId()); await user.click(againBtn()); } else await user.click(knowBtn());
    }
    expect(screen.getByTestId('summary-again')).toHaveTextContent('3');
    await user.click(button('مرور دوبارهٔ کارت‌های نادانسته (3)'));
    expect(card()).toBeVisible();
    expect(count()).toBe('1 / 3');
    const seen = [currentId()];
    await user.click(knowBtn());
    seen.push(currentId());
    await user.click(knowBtn());
    seen.push(currentId());
    expect(seen.sort()).toEqual([...unknown].sort());
    await user.click(knowBtn());
    expect(screen.getByRole('heading', { name: 'بی‌نقص!' })).toBeInTheDocument();

    await user.click(button('شروع دوبارهٔ همین جلسه (3 کارت)'));
    expect(count()).toBe('1 / 3');
    expect(card()).toHaveAttribute('data-side', 'front');
    expect(document.querySelector('.fc-tally__know')).toHaveTextContent(/^\s*0$/);
    expect(screen.queryByText(/پاسخ شما در این جلسه/)).toBeNull();

    // Restart in the middle of a session also starts from scratch.
    await user.click(againBtn());
    await user.click(button('شروع دوباره'));
    expect(count()).toBe('1 / 3');
    expect(document.querySelector('.fc-tally__again')).toHaveTextContent(/^\s*0$/);

    await user.click(button('پایان جلسه'));
    await user.click(button('تنظیم جلسهٔ جدید'));
    expect(button('شروع مرور (10 کارت)')).toBeInTheDocument();
  });

  it('a running session survives a visit to another section', async () => {
    const user = userEvent.setup();
    signedOut();
    await openReview(user);
    await user.click(button('شروع مرور (10 کارت)'));
    await user.click(knowBtn());
    const id = currentId();
    await user.click(screen.getByRole('link', { name: 'واژه‌ها' }));
    await user.click(screen.getByRole('tab', { name: categoryName(repo.categories[1]!.label) }));
    expect(screen.queryByTestId('flashcard')).not.toBeVisible();
    await user.keyboard('2'); // hidden session: no shortcuts
    await user.click(reviewTab());
    expect(currentId()).toBe(id);
    expect(count()).toBe('2 / 10');
  });
});

describe('flashcards — signed in (saved through the progress system)', () => {
  it('"know" marks the word learned and syncs it; "don\'t know" adds it to the review-again list', async () => {
    const user = userEvent.setup();
    const env = await signedIn();
    await openReview(user);
    expect(screen.getByRole('radio', { name: /یادنگرفته‌ها/ })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: /یادنگرفته‌ها/ }));
    await user.click(button('شروع مرور (10 کارت)'));

    const known = currentId();
    await user.click(knowBtn());
    const unknown = currentId();
    await user.click(againBtn());
    await waitFor(() => expect(env.cloud.serverState(ALICE.uid).get(known)).toBe(true));
    expect(env.cloud.serverState(ALICE.uid).has(unknown)).toBe(false); // nothing written for "don't know"
    expect(screen.getByTestId('header-progress')).toHaveTextContent('1/999');
    expect(env.cloud.writeLog.map((w) => w.write.origin)).toEqual(['toggle']);
    await waitFor(async () => expect((await env.local.loadReviews(ALICE.uid)).map((r) => [r.wordId, r.lastResult]).sort())
      .toEqual([[known, 'know'], [unknown, 'again']].sort()));

    await user.click(button('پایان جلسه'));
    expect(screen.getByText(/1 واژه به یادگرفته‌ها اضافه شد/)).toHaveTextContent('1 واژه در فهرست «مرور دوباره» ذخیره شد');
    await user.click(button('تنظیم جلسهٔ جدید'));

    // Review again: exactly the unknown word.
    await user.click(screen.getByRole('radio', { name: /مرور دوباره/ }));
    await user.click(button('شروع مرور (1 کارت)'));
    expect(currentId()).toBe(unknown);
    await user.click(knowBtn());
    await waitFor(() => expect(env.cloud.serverState(ALICE.uid).get(unknown)).toBe(true));
    await user.click(button('تنظیم جلسهٔ جدید'));
    expect(screen.getByRole('radio', { name: /مرور دوباره/ })).toBeChecked();
    expect(button('کارتی برای مرور نیست')).toBeDisabled();
    expect(screen.getByText('فهرست «مرور دوباره» خالی است.')).toBeInTheDocument();
  });

  it('never removes a learned mark: "don\'t know" on a learned word keeps it learned', async () => {
    const user = userEvent.setup();
    const env = await signedIn();
    await user.click(screen.getByRole('checkbox', { name: `یادگرفتم: ${first.word}` }));
    await waitFor(() => expect(env.cloud.serverState(ALICE.uid).get(first.id)).toBe(true));
    const writes = env.cloud.writeLog.length;

    await openReview(user);
    await user.click(screen.getByRole('radio', { name: /یادگرفته‌ها/ }));
    await user.click(button('شروع مرور (1 کارت)'));
    expect(currentId()).toBe(first.id);
    await user.click(againBtn());
    expect(screen.getByTestId('header-progress')).toHaveTextContent('1/999');
    expect(env.cloud.writeLog).toHaveLength(writes);
    expect(env.cloud.serverState(ALICE.uid).get(first.id)).toBe(true);
    await waitFor(async () => expect(await env.local.loadReviews(ALICE.uid)).toEqual([expect.objectContaining({ wordId: first.id, lastResult: 'again' })]));
  });

  it('unlearned mode leaves out learned words; category scope limits the deck', async () => {
    // Which ids a deck contains is covered exhaustively in deck.test.ts; here: the UI wiring.
    const user = userEvent.setup();
    await signedIn();
    const archTotal = repo.categories[0]!.subtabs.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.entries.length, 0), 0);
    await openReview(user, 'all');
    await user.click(screen.getByRole('radio', { name: /یادنگرفته‌ها/ }));
    await user.selectOptions(screen.getByLabelText('دسته'), 'arch');
    expect(button(`شروع مرور (${archTotal} کارت)`)).toBeEnabled();

    await user.click(screen.getByRole('link', { name: 'واژه‌ها' }));
    await user.click(screen.getByRole('checkbox', { name: `یادگرفتم: ${first.word}` }));
    await user.click(reviewTab());
    expect(screen.getByRole('radio', { name: /یادنگرفته‌ها/ })).toBeChecked();
    expect(screen.getByRole('option', { name: `${categoryName(repo.categories[0]!.label)} (${archTotal - 1})` })).toBeInTheDocument();
    await user.click(button(`شروع مرور (${archTotal - 1} کارت)`));
    expect(count()).toBe(`1 / ${archTotal - 1}`);
    expect(currentId()).not.toBe(first.id);
    expect(currentEntry()).toBeDefined();
  });
});
