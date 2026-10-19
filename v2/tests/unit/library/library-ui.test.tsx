import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { fakeSpeech, mockMatchMedia, waitForApp } from '../../helpers/dom';
import { ALICE, BOB } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { bundledLibrary } from '../../helpers/fakeLibrary';
import { createLibraryService, memoryLibraryCache, type LibraryState } from '../../../src/features/library/libraryService';
import { createFakeLibraryRemote } from '../../helpers/fakeLibrary';
import { LibraryIntegrityError, assembleLibrary } from '../../../src/features/library/format';

beforeEach(() => mockMatchMedia(() => false));

/** ALICE owns the built-in library; every other account has none. */
const ownerOnly = (uid: string) => (uid === ALICE.uid ? 'bundled' as const : 'empty' as const);
const VOCAB_SAMPLE = ['die Außenwand', 'Architecture', 'دیوار خارجی'];
const showsNoVocabulary = () => { for (const t of VOCAB_SAMPLE) expect(document.body.textContent).not.toContain(t); };

describe('signed out', () => {
  it('shows only the welcome screen with Google sign-in — no vocabulary, no navigation', async () => {
    render(<App services={createFakeServices({ library: ownerOnly }).services} speechService={fakeSpeech()} />);
    const welcome = await screen.findByTestId('welcome');
    expect(await within(welcome).findByRole('button', { name: 'ورود با گوگل' })).toBeEnabled();
    expect(screen.queryByRole('navigation', { name: 'بخش‌های اصلی' })).toBeNull();
    expect(document.querySelector('[data-entry-id]')).toBeNull();
    showsNoVocabulary();
  });

  it('without a Firebase configuration: the welcome screen says sign-in is not configured', () => {
    render(<App services={{ auth: null, authUnavailable: { reason: 'not-configured', details: [] }, progress: null }} speechService={fakeSpeech()} />);
    expect(screen.getByTestId('welcome')).toHaveTextContent('ورود در این نسخه پیکربندی نشده است');
    showsNoVocabulary();
  });
});

describe('account libraries', () => {
  it('the owner signs in and gets all 999 words; signing out hides them again', async () => {
    const user = userEvent.setup();
    const env = createFakeServices({ library: ownerOnly });
    render(<App services={env.services} speechService={fakeSpeech()} />);
    env.auth.willSignInAs(ALICE);
    await user.click(await screen.findByRole('button', { name: 'ورود با گوگل' }));
    await waitForApp();
    expect(screen.getByRole('tablist', { name: 'Kategorien' })).toBeInTheDocument();
    expect(await screen.findByTestId('header-progress')).toHaveTextContent('0/999');
    await user.click(screen.getByTestId('account-button'));
    await user.click(screen.getByRole('menuitem', { name: 'خروج از حساب' }));
    expect(await screen.findByTestId('welcome')).toBeInTheDocument();
    showsNoVocabulary();
  });

  it('another account starts with an empty library and manages only its own words', async () => {
    const user = userEvent.setup();
    const env = createFakeServices({ restored: BOB, library: ownerOnly });
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitForApp();
    expect(screen.getByTestId('empty-library')).toHaveTextContent('کتابخانهٔ شما خالی است');
    expect(screen.queryByRole('tablist', { name: 'Kategorien' })).toBeNull();
    expect(screen.queryByTestId('header-progress')).toBeNull();
    showsNoVocabulary();
    expect(env.libraryRemote.calls.chunks).toBe(0); // nothing of the owner's library was fetched
    // Personal words work as before.
    await user.click(screen.getByRole('button', { name: 'رفتن به «واژه‌های من»' }));
    await user.click(screen.getByRole('button', { name: 'افزودن واژه' }));
    const dialog = within(screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' }));
    await user.type(dialog.getByLabelText(/واژه یا عبارت آلمانی/), 'die Eigenwand');
    await user.type(dialog.getByRole('textbox', { name: 'معنی فارسی' }), 'دیوار خودم');
    await user.click(dialog.getByRole('button', { name: 'افزودن واژه' }));
    expect(await screen.findByRole('article', { name: 'die Eigenwand' })).toBeInTheDocument();
    // The legacy progress migration (needs the owner library) is not offered.
    await user.click(screen.getByTestId('account-button'));
    expect(screen.queryByRole('menuitem', { name: /انتقال پیشرفت از نسخهٔ قدیمی/ })).toBeNull();
  });

  it('the library appears without reload when the owner import completes', async () => {
    const env = createFakeServices({ restored: ALICE, library: () => 'empty' });
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitForApp();
    expect(screen.getByTestId('empty-library')).toBeInTheDocument();
    await act(async () => { await env.libraryRemote.setLibrary(ALICE.uid, 'bundled'); });
    expect(await screen.findByRole('tablist', { name: 'Kategorien' })).toBeInTheDocument();
  });
});

describe('library service', () => {
  const states = (remote: ReturnType<typeof createFakeLibraryRemote>, cache = memoryLibraryCache(), uid = ALICE.uid) => {
    const seen: LibraryState[] = [];
    const service = createLibraryService({ remote, cache, offlineTimeoutMs: 200, online: () => !offlineFlag.value });
    const stop = service.watch(uid, (s) => seen.push(s));
    return { seen, stop, cache, service };
  };
  const offlineFlag = { value: false };

  it('reload: the verified device copy is shown at once; offline it keeps working', async () => {
    const remote = createFakeLibraryRemote();
    const first = states(remote);
    await waitFor(() => expect(first.seen.at(-1)).toMatchObject({ status: 'ready', source: 'server' }));
    first.stop();
    expect(first.cache.entries.get(ALICE.uid)?.meta.entryCount).toBe(999);

    remote.setOffline(true);
    offlineFlag.value = true;
    try {
      const second = states(remote, first.cache);
      await waitFor(() => expect(second.seen.at(-1)).toMatchObject({ status: 'ready', source: 'cache' }));
      const ready = second.seen.at(-1);
      expect(ready?.status === 'ready' && ready.repository.totalEntries).toBe(999);
      second.stop();
      // No copy and offline: an explicit "offline" state (no partial content).
      const third = states(remote, memoryLibraryCache());
      await waitFor(() => expect(third.seen.at(-1)).toMatchObject({ status: 'error', reason: 'offline' }));
      third.stop();
    } finally {
      remote.setOffline(false);
      offlineFlag.value = false;
    }
  });

  it('integrity: an altered or missing chunk is refused', async () => {
    const { meta, chunks } = await bundledLibrary();
    await expect(assembleLibrary(meta, { ...chunks, 'category-arch': chunks['category-arch']!.replace('Außenwand', 'Aussenwand') })).rejects.toThrow(LibraryIntegrityError);
    const { 'technical-info': _drop, ...missing } = chunks;
    await expect(assembleLibrary(meta, missing)).rejects.toThrow(LibraryIntegrityError);
    await expect(assembleLibrary({ ...meta, contentHash: '0'.repeat(64) }, chunks)).rejects.toThrow(LibraryIntegrityError);
  });

  it('migration data (id registry, dvok5 maps) only for an account with a library', async () => {
    const remote = createFakeLibraryRemote(ownerOnly);
    const owner = states(remote, memoryLibraryCache(), ALICE.uid);
    await waitFor(() => expect(owner.seen.at(-1)).toMatchObject({ status: 'ready' }));
    const extras = await owner.service.loadExtras(ALICE.uid);
    expect(extras?.idRegistry.entries).toHaveLength(999);
    expect(extras?.dvok5Maps.versions.length).toBeGreaterThan(0);
    const other = states(remote, memoryLibraryCache(), BOB.uid);
    await waitFor(() => expect(other.seen.at(-1)).toMatchObject({ status: 'ready', empty: true }));
    expect(await other.service.loadExtras(BOB.uid)).toBeNull();
    owner.stop();
    other.stop();
  });
});
