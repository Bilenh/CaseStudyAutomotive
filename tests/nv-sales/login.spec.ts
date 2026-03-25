import { test, expect } from '@playwright/test';
import { loginAsTestUser } from '../../utils/auth';



test('user can log in via My Renault', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAsTestUser(page);
});





