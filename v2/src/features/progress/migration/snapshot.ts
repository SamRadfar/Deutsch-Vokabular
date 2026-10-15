import type { LegacyStorageSnapshot } from '../../../models/legacy';

/** Minimal read-only view of Web Storage. Write methods are intentionally absent. */
export interface ReadonlyStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

/**
 * Read the legacy keys without modifying storage. The API key is detected by enumerating
 * key NAMES only — its value is never read into v2.
 *
 * Not called by the app in Phase 2; the migration is executed in a later phase.
 */
export function readLegacySnapshot(storage: ReadonlyStorage): LegacyStorageSnapshot {
  let apiKeyPresent = false;
  for (let i = 0; i < storage.length; i++) {
    if (storage.key(i) === 'dvok5_apikey') apiKeyPresent = true;
  }
  return {
    dvok6: storage.getItem('dvok6'),
    dvok5: storage.getItem('dvok5'),
    dvok5_custom: storage.getItem('dvok5_custom'),
    dvok5_pron_settings: storage.getItem('dvok5_pron_settings'),
    dvok5_pron_exposure: storage.getItem('dvok5_pron_exposure'),
    dvok5_pron_selected_tabs: storage.getItem('dvok5_pron_selected_tabs'),
    dvok_sync_code: storage.getItem('dvok_sync_code'),
    dvok_theme: storage.getItem('dvok_theme'),
    dvok5_apikey_present: apiKeyPresent,
  };
}
