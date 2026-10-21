import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { createMemoryStore } from '../../../src/features/progress/localStore';
import { PersonalVocabulary } from '../../../src/features/personal/personalVocabulary';
import { fromValue, isCustomWordValue, toValue, type CustomWordValue } from '../../../src/features/personal/syncModel';
import { parseCustomWordDoc } from '../../../src/features/personal/firestoreCustomWordsRemote';
import type { PersonalWord, PersonalWordInput } from '../../../src/features/personal/model';
import { readFirebaseConfig } from '../../../src/services/firebase/config';
import { fakeSpeech, mockMatchMedia, waitForLearnedCheckboxes } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { until } from '../../helpers/fakeCloud';
import { createFakeDocCloud } from '../../helpers/fakeDocCloud';
import { createFakeServices } from '../../helpers/fakeServices';

beforeEach(() => mockMatchMedia(() => false));

const input = (o: Partial<PersonalWordInput> = {}): PersonalWordInput => ({
  article: 'die', lemma: 'Probewand', type: 'n', grammar: '', fa: 'دیوار آزمایشی', example: '', exampleFa: '', pronunciationFa: '', placement: null, ...o,
});
const word = (o: Partial<PersonalWord> = {}): PersonalWord => ({
  schemaVersion: 1, id: 'pw_0123456789abcdef0123', article: 'die', lemma: 'Probewand', type: 'n', grammar: '', fa: 'دیوار',
  example: '', exampleFa: '', pronunciationFa: '', placement: null, learned: false, createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000, source: 'manual', legacyId: null, ...o,
});

describe('sync model', () => {
  it('round-trips a word through the synced value; validates like the rules', () => {
    const w = word({ placement: { category: 'arch', subtab: 'bau' }, learned: true });
    expect(fromValue(w.id, toValue(w))).toEqual(w);
    expect(isCustomWordValue(toValue(w, true))).toBe(true);
    expect(isCustomWordValue({ ...toValue(w), lemma: '' })).toBe(false);
    expect(isCustomWordValue({ ...toValue(w), deleted: 'yes' })).toBe(false);
    expect(isCustomWordValue({ ...toValue(w), placement: { category: 'arch' } })).toBe(false);
    expect(isCustomWordValue({ ...toValue(w), createdAt: 1e13 })).toBe(false);
  });

  it('parses Firestore documents strictly (wrong id, schema or field → ignored)', () => {
    const data = {
      schemaVersion: 1, id: 'pw_0123456789abcdef0123', article: 'die', lemma: 'Probewand', type: 'n', grammar: '', fa: 'دیوار', example: '',
      exampleFa: '', pronunciationFa: '', placement: null, learned: false, deleted: false, source: 'manual', legacyId: null,
      createdAt: 1, clientUpdatedAt: 2, updatedAt: { seconds: 10, nanoseconds: 500_000 }, opId: 'op', deviceId: 'd',
    };
    expect(parseCustomWordDoc(data.id, data)).toMatchObject({ id: data.id, opId: 'op', serverUpdatedAt: 10_000.5, value: { lemma: 'Probewand', updatedAt: 2 } });
    expect(parseCustomWordDoc('pw_ffffffffffffffffffff', data)).toBeNull();
    expect(parseCustomWordDoc(data.id, { ...data, schemaVersion: 2 })).toBeNull();
    expect(parseCustomWordDoc(data.id, { ...data, type: 'zz' })).toBeNull();
  });

  it('cloud sync of personal words is off unless enabled (or on the emulator)', () => {
    const base = {
      VITE_FIREBASE_ENV: 'development', VITE_FIREBASE_API_KEY: `AIza${'x'.repeat(35)}`, VITE_FIREBASE_AUTH_DOMAIN: 'deutsch-vokabular-v2-dev.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'deutsch-vokabular-v2-dev', VITE_FIREBASE_APP_ID: '1:123456789012:web:abcdef', VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
      VITE_FIREBASE_STORAGE_BUCKET: 'deutsch-vokabular-v2-dev.firebasestorage.app',
    };
    const off = readFirebaseConfig(base);
    const on = readFirebaseConfig({ ...base, VITE_PERSONAL_WORDS_SYNC: 'true' });
    const bad = readFirebaseConfig({ ...base, VITE_PERSONAL_WORDS_SYNC: 'yes' });
    expect(off.status === 'configured' && off.personalWordsSync).toBe(false);
    expect(on.status === 'configured' && on.personalWordsSync).toBe(true);
    expect(bad.status).toBe('invalid');
  });
});

describe('PersonalVocabulary with a cloud (fake, rules-like)', () => {
  const setup = async () => {
    const cloud = createFakeDocCloud<CustomWordValue>();
    const make = async (remote = cloud.device()) => {
      const v = new PersonalVocabulary('alice', createMemoryStore(), { remote, deviceId: 'd', retryBaseMs: 5, retryMaxMs: 20, firstSnapshotTimeoutMs: 50 });
      await v.load();
      return { v, remote };
    };
    return { cloud, make };
  };

  it('local-only mode keeps changes queued on the device and reports it', async () => {
    const v = new PersonalVocabulary('alice', createMemoryStore());
    await v.load();
    v.add(input());
    expect(v.getSnapshot().sync).toMatchObject({ mode: 'local', status: { remote: 'local', pendingCount: 1 } });
  });

  it('a deleted word cannot come back: a stale edit becomes a copy, the user is told, nothing is lost', async () => {
    const { cloud, make } = await setup();
    const { v, remote } = await make();
    const r = v.add(input());
    const id = r.ok ? r.word.id : '';
    await until(() => v.getSnapshot().sync.status.pendingCount === 0, 2000, 'uploaded');
    remote.setOnline(false);
    v.update(id, input({ fa: 'ویرایش آفلاین' }));
    cloud.external('alice', id, { ...cloud.get('alice', id)!, deleted: true }); // another device deleted it
    remote.setOnline(true);
    await until(() => v.getSnapshot().conflicts.length === 1, 2000, 'conflict copy');
    const { copyId } = v.getSnapshot().conflicts[0]!;
    expect(v.getSnapshot().byId.has(id)).toBe(false);
    expect(v.getSnapshot().byId.get(copyId)).toMatchObject({ fa: 'ویرایش آفلاین' });
    await until(() => cloud.get('alice', copyId)?.fa === 'ویرایش آفلاین', 2000, 'copy uploaded');
    expect(cloud.get('alice', id)).toMatchObject({ deleted: true });
    v.dismissConflict(copyId);
    expect(v.getSnapshot().conflicts).toEqual([]);
  });

  it('a rejected write stays visible as failed until retried (e.g. rules not deployed yet)', async () => {
    const { cloud, make } = await setup();
    const { v, remote } = await make();
    remote.failNextWrites(1, { code: 'permission-denied', permanent: true });
    const r = v.add(input());
    const id = r.ok ? r.word.id : '';
    await until(() => v.getSnapshot().sync.stateOf(id) === 'failed', 2000, 'failed');
    expect(v.getSnapshot().byId.has(id)).toBe(true); // kept locally
    expect(v.getSnapshot().sync.status.failedCount).toBe(1);
    v.retryFailed();
    await until(() => v.getSnapshot().sync.stateOf(id) === 'synced', 2000, 'synced after retry');
    expect(cloud.get('alice', id)).toMatchObject({ lemma: 'Probewand' });
  });

  it('undo after delete restores the content under a new id (the tombstone stays final)', async () => {
    const { cloud, make } = await setup();
    const { v } = await make();
    const r = v.add(input());
    const id = r.ok ? r.word.id : '';
    const removed = v.remove(id)!;
    const copy = v.restore(removed);
    await until(() => v.getSnapshot().sync.status.pendingCount === 0, 2000, 'settled');
    expect(cloud.get('alice', id)).toMatchObject({ deleted: true });
    expect(cloud.get('alice', copy.id)).toMatchObject({ deleted: false, lemma: 'Probewand' });
    expect(v.getSnapshot().words.map((w) => w.id)).toEqual([copy.id]);
  });
});

describe('my words UI with cloud sync', () => {
  async function signedInCloud() {
    const env = createFakeServices({ restored: ALICE, personalSync: true });
    const user = userEvent.setup();
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitForLearnedCheckboxes();
    await user.click(screen.getByRole('link', { name: 'واژه‌های من' }));
    return { env, user };
  }
  async function add(user: ReturnType<typeof userEvent.setup>, lemma: string) {
    await user.click(screen.getByRole('button', { name: 'افزودن واژه' }));
    const d = screen.getByRole('dialog', { name: 'افزودن واژهٔ جدید' });
    await user.type(within(d).getByLabelText(/واژه یا عبارت آلمانی/), lemma);
    await user.type(within(d).getByLabelText(/معنی فارسی/), 'آزمایشی');
    await user.click(within(d).getByRole('button', { name: 'افزودن واژه' }));
  }

  it('shows the cloud status honestly: pending → synced', async () => {
    const { env, user } = await signedInCloud();
    env.personalRemote.setOnline(false);
    await add(user, 'Wolkenwort');
    const card = screen.getByRole('article', { name: 'Wolkenwort' }); // a noun without article (none chosen)
    expect(card).toHaveTextContent('در انتظار همگام‌سازی');
    act(() => env.personalRemote.setOnline(true));
    // Server-confirmed ("ذخیره شد"); the test store is in memory, which the status line also states.
    await waitFor(() => expect(screen.getByTestId('pw-storage')).toHaveTextContent(/ذخیره شد/));
    expect(screen.getByTestId('pw-storage')).toHaveAttribute('data-mode', 'cloud');
    expect(screen.getByRole('article', { name: 'Wolkenwort' })).not.toHaveTextContent('در انتظار همگام‌سازی');
    expect(env.personalCloud.writes).toHaveLength(1);
  });

  it('a rejected upload is shown as an error with "retry"; the word stays on the device', async () => {
    const { env, user } = await signedInCloud();
    env.personalRemote.failNextWrites(1, { code: 'permission-denied', permanent: true });
    await add(user, 'Abgelehnt');
    await waitFor(() => expect(screen.getByRole('article', { name: 'Abgelehnt' })).toHaveTextContent('در ابر ذخیره نشد'));
    expect(screen.getByTestId('pw-storage')).toHaveTextContent('خطا در همگام‌سازی');
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    await waitFor(() => expect(screen.getByTestId('pw-storage')).toHaveTextContent(/ذخیره شد/));
    expect(screen.queryByRole('button', { name: 'تلاش دوباره' })).toBeNull();
  });

  it('words from another device appear; a deletion elsewhere removes them here', async () => {
    const { env } = await signedInCloud();
    const w = word({ id: 'pw_0000000000000000abcd', lemma: 'Fernwort', article: null, type: 'au' });
    act(() => env.personalCloud.external(ALICE.uid, w.id, toValue(w)));
    expect(await screen.findByRole('article', { name: 'Fernwort' })).toBeInTheDocument();
    act(() => env.personalCloud.external(ALICE.uid, w.id, toValue(w, true)));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Fernwort' })).toBeNull());
  });

  it('an edit to a word deleted on another device is kept as a copy and explained', async () => {
    const { env, user } = await signedInCloud();
    await add(user, 'Streitwort');
    await waitFor(() => expect(env.personalCloud.writes).toHaveLength(1));
    const id = env.personalCloud.writes[0]!.write.id;
    env.personalRemote.setOnline(false);
    await user.click(screen.getByRole('button', { name: 'ویرایش Streitwort' }));
    const d = screen.getByRole('dialog', { name: 'ویرایش واژه' });
    await user.clear(within(d).getByLabelText(/معنی فارسی/));
    await user.type(within(d).getByLabelText(/معنی فارسی/), 'ویرایش من');
    await user.click(within(d).getByRole('button', { name: 'ذخیرهٔ تغییرات' }));
    env.personalCloud.external(ALICE.uid, id, { ...env.personalCloud.get(ALICE.uid, id)!, deleted: true });
    act(() => env.personalRemote.setOnline(true));
    expect(await screen.findByRole('alert')).toHaveTextContent('در دستگاه دیگری حذف شده بود');
    expect(screen.getByRole('article', { name: 'Streitwort' })).toHaveTextContent('ویرایش من');
    await user.click(screen.getByRole('button', { name: 'متوجه شدم' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
