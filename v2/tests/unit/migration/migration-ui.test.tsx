import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../src/app/App';
import { createBackup } from '../../../src/features/progress/migration/backup';
import { getVocabularyRepository } from '../../../src/services/content/vocabularyRepository';
import { fakeSpeech, mockMatchMedia } from '../../helpers/dom';
import { ALICE } from '../../helpers/fakeAuth';
import { createFakeServices } from '../../helpers/fakeServices';
import { dvok6, snapshot } from './legacy-snapshots';

const repo = getVocabularyRepository();
const first = repo.categories[0]!.subtabs[0]!.groups[0]!.entries[0]!;
const backupFile = (keys: string[]) => new File(
  [JSON.stringify(createBackup(snapshot({ dvok6: dvok6(...keys) }), 'console-export'))],
  'backup.json', { type: 'application/json' },
);

beforeEach(() => mockMatchMedia(() => false));

async function openMigration(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('account-button'));
  await user.click(screen.getByRole('menuitem', { name: 'انتقال پیشرفت از نسخهٔ قدیمی…' }));
  // The dialog is lazy-loaded.
  return screen.findByRole('dialog', { name: 'انتقال پیشرفت از نسخهٔ قدیمی' }, { timeout: 5000 });
}

describe('legacy migration dialog', () => {
  it('explains the origin limitation, previews, requires confirmation, imports and blocks a repeat', async () => {
    const user = userEvent.setup();
    const env = createFakeServices({ restored: ALICE });
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: `یادگرفتم: ${first.word}` })).toBeInTheDocument());

    let dialog = await openMigration(user);
    expect(dialog).toHaveTextContent('حافظهٔ مرورگر به دامنه وابسته است');
    await user.upload(within(dialog).getByTestId('migration-file'), backupFile(['arch::die Außenwand', 'bautechnik::der Wärmeschutz']));
    const preview = await screen.findByTestId('migration-preview');
    expect(within(preview).getByTestId('mig-to-import')).toHaveTextContent('1');
    expect(within(preview).getByTestId('mig-orphans')).toHaveTextContent('1');
    expect(preview).toHaveTextContent('bautechnik::der Wärmeschutz');
    const importButton = within(preview).getByTestId('mig-import');
    expect(importButton).toBeDisabled(); // explicit confirmation required
    await user.click(within(preview).getByRole('checkbox'));
    await user.click(importButton);
    expect(await screen.findByText(/انتقال کامل شد: 1 واژه/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'بستن' }));
    expect(screen.getByRole('checkbox', { name: `یادگرفتم: ${first.word}` })).toBeChecked();
    expect(env.account.records.size).toBe(1);

    dialog = await openMigration(user);
    await user.upload(within(dialog).getByTestId('migration-file'), backupFile(['arch::die Außenwand', 'bautechnik::der Wärmeschutz']));
    expect(await screen.findByText('این داده قبلاً به حساب شما منتقل شده است. ورود دوباره غیرفعال است.')).toBeInTheDocument();
    expect(screen.getByTestId('mig-import')).toBeDisabled();
  }, 20_000);

  it('rejects an invalid file with a Persian error and leaves everything unchanged', async () => {
    const user = userEvent.setup();
    const env = createFakeServices({ restored: ALICE });
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: `یادگرفتم: ${first.word}` })).toBeInTheDocument());
    const dialog = await openMigration(user);
    await user.upload(within(dialog).getByTestId('migration-file'), new File(['{oops'], 'x.json', { type: 'application/json' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('JSON معتبر نیست');
    expect(env.cloud.writeLog).toHaveLength(0);
  });

  it('reads same-origin legacy data when present, without modifying it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('dvok6', dvok6('arch::die Außenwand'));
    localStorage.setItem('dvok5_apikey', 'sk-ant-FAKE-test-key-not-real-0000');
    const before = JSON.stringify({ ...localStorage });
    const env = createFakeServices({ restored: ALICE });
    render(<App services={env.services} speechService={fakeSpeech()} />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: `یادگرفتم: ${first.word}` })).toBeInTheDocument());
    const dialog = await openMigration(user);
    await user.click(within(dialog).getByRole('button', { name: 'بررسی داده‌های این مرورگر' }));
    const preview = await screen.findByTestId('migration-preview');
    expect(preview).toHaveTextContent('کلید API هرگز منتقل نمی‌شود');
    expect(within(preview).getByTestId('mig-to-import')).toHaveTextContent('1');
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});
