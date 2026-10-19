import type { AppServices } from '../../src/app/services';
import type { AccountRemote, MigrationRecord } from '../../src/features/progress/accountRemote';
import { createMemoryStore, type ProgressLocalStore } from '../../src/features/progress/localStore';
import { createFakeAuth } from './fakeAuth';
import { createFakeCloud } from './fakeCloud';
import { createFakeDocCloud } from './fakeDocCloud';
import type { CustomWordValue } from '../../src/features/personal/syncModel';
import type { AiClient } from '../../src/features/ai/aiClient';
import { createLibraryService, memoryLibraryCache } from '../../src/features/library/libraryService';
import { createFakeLibraryRemote, type LibraryKind } from './fakeLibrary';

export function createFakeAccountRemote() {
  const records = new Map<string, MigrationRecord>();
  const profiles = new Map<string, unknown>();
  const remote: AccountRemote & { records: typeof records; profiles: typeof profiles; profileWrites: number } = {
    records,
    profiles,
    profileWrites: 0,
    async saveProfile(uid, profile) { remote.profileWrites++; profiles.set(uid, profile); },
    async getMigrationRecord(uid, hash) { return records.get(`${uid}/${hash}`) ?? null; },
    async createMigrationRecord(uid, record) {
      const key = `${uid}/${record.inputHash}`;
      if (records.has(key)) throw { code: 'permission-denied', permanent: true }; // create-only, like the rules
      records.set(key, record);
    },
  };
  return remote;
}

/**
 * Complete fake environment for App: fake identity provider, fake cloud, memory store, and the
 * account libraries (default: every account owns the built-in library; pass `library` to choose).
 */
export function createFakeServices(options: Parameters<typeof createFakeAuth>[0] & { personalSync?: boolean; ai?: AiClient; library?: (uid: string) => LibraryKind } = {}) {
  const auth = createFakeAuth(options);
  const personalCloud = createFakeDocCloud<CustomWordValue>();
  const personalRemote = personalCloud.device();
  const cloud = createFakeCloud();
  const remote = cloud.device('this-browser');
  const account = createFakeAccountRemote();
  const local: ProgressLocalStore = createMemoryStore();
  const libraryRemote = createFakeLibraryRemote(options.library);
  const libraryCache = memoryLibraryCache();
  const library = createLibraryService({ remote: libraryRemote, cache: libraryCache, offlineTimeoutMs: 2000 });
  const services: AppServices = {
    auth,
    library,
    ...(options.ai ? { ai: options.ai } : {}),
    progress: {
      createRemote: () => remote, account, createLocalStore: async () => local,
      // Personal-word cloud sync only when asked for (mirrors config.personalWordsSync).
      ...(options.personalSync ? { createPersonalRemote: () => personalRemote } : {}),
    },
  };
  return { services, auth, cloud, remote, account, local, personalCloud, personalRemote, libraryRemote, libraryCache };
}
