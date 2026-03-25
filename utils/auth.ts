import { Page } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { LoginPage } from '../pages/LoginPage';

// Load staging environment variables by default
dotenv.config({
  path: path.resolve(process.cwd(), 'env/.env.staging'),
});

const EMAIL = process.env.TEST_USER_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD;
const BASE_URL = process.env.BASE_URL;

export async function loginAsTestUser(page: Page) {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'Missing TEST_USER_EMAIL or TEST_USER_PASSWORD in env/.env.staging. Please set them before running login tests.',
    );
  }
  if (!BASE_URL) {
    throw new Error(
      'Missing BASE_URL in env/.env.staging. Please set it (e.g. BASE_URL=https://www.renault.pt/) before running login tests.',
    );
  }

  const loginPage = new LoginPage(page);

  await loginPage.login(EMAIL, PASSWORD);
  await loginPage.expectLoggedIn();
}

