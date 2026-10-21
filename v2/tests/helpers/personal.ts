import type { ProgressLocalStore } from '../../src/features/progress/localStore';
import { fromValue, type CustomWordValue } from '../../src/features/personal/syncModel';
import type { PersonalWord } from '../../src/features/personal/model';
import type { CategoryValue } from '../../src/features/categories/model';

/** Live personal words as stored on the device (sync queue over confirmed copy, tombstones removed). */
export async function storedWords(local: ProgressLocalStore, uid: string): Promise<PersonalWord[]> {
  const { confirmed, pending } = await local.docStore<CustomWordValue>('customWords').load(uid);
  const values = new Map<string, CustomWordValue>();
  for (const c of confirmed) values.set(c.id, c.value);
  for (const p of pending) values.set(p.id, p.value);
  return [...values].filter(([, v]) => !v.deleted).map(([id, v]) => fromValue(id, v));
}

/** Live account categories as stored on the device (sync queue over confirmed copy, tombstones removed). */
export async function storedCategories(local: ProgressLocalStore, uid: string): Promise<Array<{ id: string } & CategoryValue>> {
  const { confirmed, pending } = await local.docStore<CategoryValue>('categories').load(uid);
  const values = new Map<string, CategoryValue>();
  for (const c of confirmed) values.set(c.id, c.value);
  for (const p of pending) values.set(p.id, p.value);
  return [...values].filter(([, v]) => !v.deleted).map(([id, v]) => ({ id, ...v }));
}
