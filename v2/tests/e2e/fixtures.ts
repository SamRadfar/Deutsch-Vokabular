// The vocabulary exists only inside an account: every test of this suite runs as a fresh emulator
// account that owns the built-in library (signed in + seeded before the test body). Tests about
// the signed-out welcome screen opt out with `test.use({ owner: false })`.
import { test as base } from '@playwright/test';
import { signIn, uniqueEmail } from '../e2e-emulator/helpers';

export const test = base.extend<{ owner: boolean }>({
  owner: [true, { option: true }],
  page: async ({ page, owner }, use) => {
    if (owner) {
      await page.goto('./');
      await signIn(page, uniqueEmail('owner'), 'Library Owner');
    }
    await use(page);
  },
});
export { expect } from '@playwright/test';
