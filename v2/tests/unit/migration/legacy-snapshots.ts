// Synthetic legacy snapshots. No real user data, no real API keys.

import type { LegacyCustomWord, LegacyStorageSnapshot } from '../../../src/models/legacy';

export const FAKE_API_KEY = 'sk-ant-FAKE-test-key-not-real-0000';

export function snapshot(overrides: Partial<LegacyStorageSnapshot> = {}): LegacyStorageSnapshot {
  return {
    dvok6: null,
    dvok5: null,
    dvok5_custom: null,
    dvok5_pron_settings: null,
    dvok5_pron_exposure: null,
    dvok5_pron_selected_tabs: null,
    dvok_sync_code: null,
    dvok_theme: null,
    dvok5_apikey_present: false,
    ...overrides,
  };
}

export const dvok6 = (...keys: string[]) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, true])));

/** A dvok5 blob as written by legacy save(): one boolean per checkbox index. */
export function dvok5(count: number, checked: number[] = []): string {
  const set = new Set(checked);
  return JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), set.has(i)])));
}

export function customWord(overrides: Partial<LegacyCustomWord> = {}): LegacyCustomWord {
  return {
    id: 'cw1700000000000',
    main: 'arch',
    tab: 'bau',
    word: 'die Nachhaltigkeit',
    sentence: '',
    type: 'n',
    fa: 'پایداری',
    ex: 'Nachhaltigkeit ist wichtig.',
    exFa: 'پایداری مهم است.',
    pr: 'دی ناخ‌هالتیش‌کایت',
    status: 'ready',
    checked: false,
    ...overrides,
  };
}
