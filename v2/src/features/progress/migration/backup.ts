// JSON backup of legacy localStorage data. Used (a) to let the user keep a copy before
// importing and (b) as the import path when v2 runs on a different origin than the legacy
// app (localStorage is origin-scoped; e.g. localhost cannot read samradfar.github.io).
// Secrets are never part of a backup: the Anthropic API key and the sync code are excluded
// on export and stripped on import.

import type { LegacyStorageSnapshot } from '../../../models/legacy';

export const BACKUP_FORMAT = 'deutsch-vokabular/legacy-backup';
export const BACKUP_KEYS = [
  'dvok6', 'dvok5', 'dvok5_custom', 'dvok5_pron_settings', 'dvok5_pron_exposure', 'dvok5_pron_selected_tabs', 'dvok_theme',
] as const;
export type BackupKey = (typeof BACKUP_KEYS)[number];
const FORBIDDEN_KEYS = ['dvok5_apikey', 'dvok_sync_code'];
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export interface LegacyBackupV1 {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  source: 'same-origin' | 'console-export' | 'unknown';
  keys: Record<BackupKey, string | null>;
}

export function createBackup(snapshot: LegacyStorageSnapshot, source: LegacyBackupV1['source'], now = new Date()): LegacyBackupV1 {
  const keys = Object.fromEntries(BACKUP_KEYS.map((k) => [k, snapshot[k]])) as Record<BackupKey, string | null>;
  return { format: BACKUP_FORMAT, version: 1, createdAt: now.toISOString(), source, keys };
}

export function backupToSnapshot(backup: LegacyBackupV1): LegacyStorageSnapshot {
  return { ...backup.keys, dvok_sync_code: null, dvok5_apikey_present: false };
}

export type ParsedBackup =
  | { ok: true; backup: LegacyBackupV1; warnings: string[] }
  | { ok: false; error: string };

/** Strict, defensive parsing of a user-supplied backup file. Error messages are Persian. */
export function parseBackup(text: string): ParsedBackup {
  if (new Blob([text]).size > MAX_BACKUP_BYTES) return { ok: false, error: 'فایل بزرگ‌تر از حد مجاز (۵ مگابایت) است.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'فایل JSON معتبر نیست.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'ساختار فایل پشتیبان شناخته نشد.' };
  const r = raw as Record<string, unknown>;
  if (r.format !== BACKUP_FORMAT) return { ok: false, error: 'این فایل، پشتیبان Deutsch Vokabular نیست.' };
  if (r.version !== 1) return { ok: false, error: 'نسخهٔ فایل پشتیبان پشتیبانی نمی‌شود.' };
  if (typeof r.keys !== 'object' || r.keys === null || Array.isArray(r.keys)) return { ok: false, error: 'بخش داده‌ها (keys) در فایل پیدا نشد.' };
  const inKeys = r.keys as Record<string, unknown>;
  const warnings: string[] = [];
  if (FORBIDDEN_KEYS.some((k) => k in inKeys)) {
    warnings.push('فایل شامل کلید API یا کد همگام‌سازی بود؛ این مقادیر نادیده گرفته شدند و هرگز منتقل نمی‌شوند.');
  }
  const keys = {} as Record<BackupKey, string | null>;
  for (const k of BACKUP_KEYS) {
    const v = inKeys[k];
    if (v === undefined || v === null) keys[k] = null;
    else if (typeof v === 'string') keys[k] = v;
    else return { ok: false, error: `مقدار «${k}» در فایل معتبر نیست.` };
  }
  const source = r.source === 'same-origin' || r.source === 'console-export' ? r.source : 'unknown';
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : '';
  return { ok: true, backup: { format: BACKUP_FORMAT, version: 1, createdAt, source, keys }, warnings };
}

export const hasLegacyProgress = (s: LegacyStorageSnapshot) => s.dvok6 !== null || s.dvok5 !== null;

/** SHA-256 of the canonical import input (fixed key order, raw strings) — idempotency key. */
export async function hashSnapshot(snapshot: LegacyStorageSnapshot): Promise<string> {
  const canonical = JSON.stringify(BACKUP_KEYS.map((k) => [k, snapshot[k]]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
