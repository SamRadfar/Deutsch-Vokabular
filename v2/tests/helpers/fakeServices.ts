import type { AppServices } from '../../src/app/services';
import type { AccountRemote, MigrationRecord } from '../../src/features/progress/accountRemote';
import { createMemoryStore, type ProgressLocalStore } from '../../src/features/progress/localStore';
import { createFakeAuth } from './fakeAuth';
import { createFakeCloud } from './fakeCloud';

export function createFakeAccountRemote() {
  const records = new Map<string, MigrationRecord>();
  const profiles = new Map<string, unknown>();
  const remote: AccountRemote & { records: typeof records; profiles: typeof profiles } = {
    records,
    profiles,
    async saveProfile(uid, profile) { profiles.set(uid, profile); },
    async getMigrationRecord(uid, hash) { return records.get(`${uid}/${hash}`) ?? null; },
    async createMigrationRecord(uid, record) {
      const key = `${uid}/${record.inputHash}`;
      if (records.has(key)) throw { code: 'permission-denied', permanent: true }; // create-only, like the rules
      records.set(key, record);
    },
  };
  return remote;
}

/** Complete fake environment for App: fake identity provider, fake cloud, memory store. */
export function createFakeServices(options: Parameters<typeof createFakeAuth>[0] = {}) {
  const auth = createFakeAuth(options);
  const cloud = createFakeCloud();
  const remote = cloud.device('this-browser');
  const account = createFakeAccountRemote();
  const local: ProgressLocalStore = createMemoryStore();
  const services: AppServices = {
    auth,
    progress: { createRemote: () => remote, account, createLocalStore: async () => local },
  };
  return { services, auth, cloud, remote, account, local };
}
