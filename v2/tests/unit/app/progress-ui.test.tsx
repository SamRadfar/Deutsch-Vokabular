import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { getBundledRepository as getVocabularyRepository } from '../../../src/services/content/bundled';
import { buildLegacyKeyIndex } from '../../../src/services/content/idRegistry';
import { fakeSpeech, mockMatchMedia, MOBILE, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE, BOB } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { categoryName } from '../../../src/models/vocabulary';
import { bundledIdRegistry as idRegistry } from '../../../src/services/content/bundled';

const repo = getVocabularyRepository();
const first = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!; // die Außenwand
const firstSubtabTotal = repo.categories[0]!.subtabs[0]!.groups.reduce((n, g) => n + g.entries.length, 0);

beforeEach(() => mockMatchMedia(() => false));

const checkbox = (word: string) => screen.getByRole('checkbox', { name: `یادگرفتم: ${word}` });
async function signedInApp(restored = ALICE) {
  const env = createFakeServices({ restored });
  const view = render(<App services={env.services} speechService={fakeSpeech()} />);
  await waitForLearnedCheckboxes();
  return { ...env, ...view };
}

describe('authentication UI', () => {
  it('never shows personal data while the session is still being restored', async () => {
    const env = createFakeServices({ restored: ALICE, restoreDelayMs: 50 });
    render(<App services={env.services} speechService={fakeSpeech()} />);
    expect(screen.getByRole('status', { name: 'در حال بررسی وضعیت ورود…' })).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    await waitForLearnedCheckboxes();
  });

  it('sign in via the button, then sign out from the account menu', async () => {
    const user = userEvent.setup();
    const env = createFakeServices();
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await user.click(await screen.findByRole('button', { name: 'ورود با گوگل' }));
    await waitForLearnedCheckboxes();
    await user.click(screen.getByTestId('account-button'));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent(ALICE.displayName!);
    expect(menu).toHaveTextContent(ALICE.email!);
    await user.click(within(menu).getByRole('menuitem', { name: 'خروج از حساب' }));
    expect(await screen.findByRole('button', { name: 'ورود با گوگل' })).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('shows Persian errors for blocked popups and cancellation', async () => {
    const user = userEvent.setup();
    const env = createFakeServices();
    render(<App services={env.services} speechService={fakeSpeech()} />);
    env.auth.willFailSignIn('auth/popup-blocked');
    await user.click(await screen.findByRole('button', { name: 'ورود با گوگل' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('پنجرهٔ ورود را مسدود کرد');
    await user.click(screen.getByRole('button', { name: 'بستن پیام' }));
    env.auth.willFailSignIn('auth/popup-closed-by-user');
    await user.click(screen.getByRole('button', { name: 'ورود با گوگل' }));
    await waitFor(() => expect(screen.getByText('ورود لغو شد.')).toBeInTheDocument());
  });

  it('account menu is keyboard operable (arrow keys, Escape returns focus)', async () => {
    const user = userEvent.setup();
    await signedInApp();
    const button = screen.getByTestId('account-button');
    button.focus();
    await user.keyboard('{Enter}');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('learned progress UI', () => {
  it('mark/unmark updates the row, header and subtab counters immediately and is confirmed', async () => {
    const user = userEvent.setup();
    const { cloud } = await signedInApp();
    expect(screen.getByTestId('header-progress')).toHaveTextContent(`0/${repo.totalEntries}`);
    await user.click(checkbox(first.word));
    expect(checkbox(first.word)).toBeChecked();
    expect(screen.getByTestId('header-progress')).toHaveTextContent(`1/${repo.totalEntries}`);
    expect(screen.getByTestId('subtab-progress')).toHaveTextContent(`1/${firstSubtabTotal}`);
    expect(screen.getAllByRole('tab', { selected: true })[1]).toHaveTextContent(`1/${firstSubtabTotal}`);
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('ذخیره شد'));
    expect(cloud.serverState(ALICE.uid).get(first.id)).toBe(true);
    await user.click(checkbox(first.word));
    expect(checkbox(first.word)).not.toBeChecked();
    await waitFor(() => expect(cloud.serverState(ALICE.uid).get(first.id)).toBe(false));
  });

  it('entries sharing a legacy key (duplicates) have independent checkboxes', async () => {
    const user = userEvent.setup();
    await signedInApp();
    await user.click(screen.getByRole('tab', { name: categoryName(repo.getCategory('bauphysik')!.label) }));
    await user.click(screen.getByRole('tab', { name: /BÖ5/ }));
    const [a, b] = screen.getAllByRole('checkbox', { name: 'یادگرفتم: der Hebelarm' });
    const [idA] = buildLegacyKeyIndex(idRegistry).get('bauphysik::der Hebelarm')!;
    await user.click(a!);
    expect(a).toBeChecked();
    expect(b).not.toBeChecked();
    expect(a!.closest('tr')).toHaveAttribute('data-entry-id', idA);
  });

  it('progress persists across a remount (reload) of the app', async () => {
    const user = userEvent.setup();
    const env = await signedInApp();
    await user.click(checkbox(first.word));
    await waitFor(() => expect(env.cloud.serverState(ALICE.uid).get(first.id)).toBe(true));
    env.unmount();
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitFor(() => expect(document.querySelector(`[data-entry-id="${first.id}"] input.vchk`)).toBeChecked()); // cheap query (see waitForLearnedCheckboxes)
    expect(checkbox(first.word)).toBeChecked();
  });

  it('account switching never shows the previous account’s progress', async () => {
    const user = userEvent.setup();
    const env = await signedInApp();
    await user.click(checkbox(first.word));
    await waitFor(() => expect(env.cloud.serverState(ALICE.uid).get(first.id)).toBe(true));
    act(() => env.auth.switchUserExternally(BOB));
    await waitFor(() => expect(screen.getByTestId('header-progress')).toHaveTextContent(`0/${repo.totalEntries}`));
    expect(checkbox(first.word)).not.toBeChecked();
    act(() => env.auth.switchUserExternally(ALICE));
    await waitFor(() => expect(document.querySelector(`[data-entry-id="${first.id}"] input.vchk`)).toBeChecked()); // cheap query (see waitForLearnedCheckboxes)
    expect(checkbox(first.word)).toBeChecked();
  });

  it('signing out with unsynced changes explains that they are kept on this device', async () => {
    const user = userEvent.setup();
    const env = await signedInApp();
    env.remote.setOnline(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    await user.click(checkbox(first.word));
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('آفلاین — 1 تغییر در انتظار'));
    await user.click(screen.getByTestId('account-button'));
    await user.click(screen.getByRole('menuitem', { name: 'خروج از حساب' }));
    const dialog = screen.getByRole('dialog', { name: 'تغییرات همگام‌نشده' });
    expect(dialog).toHaveTextContent('پاک نمی‌شوند');
    await user.click(within(dialog).getByRole('button', { name: 'خروج و نگه‌داشتن روی این دستگاه' }));
    expect(await screen.findByRole('button', { name: 'ورود با گوگل' })).toBeInTheDocument();
    const pending = await env.local.load(ALICE.uid);
    expect(pending.pending.map((p) => p.wordId)).toEqual([first.id]); // kept for alice only
    expect((await env.local.load(BOB.uid)).pending).toEqual([]);
  });

  it('mobile cards include the learned checkbox', async () => {
    mockMatchMedia(MOBILE);
    await signedInApp();
    expect(checkbox(first.word).closest('article')).toHaveClass('vcard');
  });
});

describe('Firestore write cost', () => {
  it('writes the profile once, not on every session start', async () => {
    const env = await signedInApp();
    await waitFor(() => expect(env.account.profileWrites).toBe(1));
    env.unmount();
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitForLearnedCheckboxes();
    await new Promise((r) => setTimeout(r, 50));
    expect(env.account.profileWrites).toBe(1);
  });
});
