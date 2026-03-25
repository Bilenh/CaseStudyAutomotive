import { Page, expect } from '@playwright/test';

export class LoginPage {
  private page: Page;
  private readonly url: string;

  private static readonly emailFieldSelector =
    'input[name="phoneOrEmail"], input[name="email"], input[type="email"], input[autocomplete="username"]';

  private static readonly passwordFieldSelector =
    'input[name="password"][type="password"], input[type="password"], input[autocomplete="current-password"]';

  constructor(page: Page) {
    this.page = page;
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      throw new Error(
        'Missing BASE_URL. Set it in env/.env.staging (or your env file) or export BASE_URL before running tests.',
      );
    }
    this.url = baseUrl;
  }

  // --- Locators ---

  private cookiesDialog() {
    return this.page.getByRole('dialog', { name: /cookies|Funcionamento dos cookies/i });
  }

  private onetrustControls() {
    return this.page.locator('[id^="onetrust-"]');
  }

  /** Language-agnostic (stable `name` attributes on ID Connect / My Renault). */
  private loginEmailInput() {
    return this.page.locator(LoginPage.emailFieldSelector);
  }

  private loginPasswordInput() {
    return this.page.locator(LoginPage.passwordFieldSelector);
  }

  /** Submit scoped to the form containing the email field. */
  private loginForm() {
    return this.loginEmailInput().first().locator('xpath=ancestor::form[1]');
  }

  private loginSubmitButton() {
    return this.loginForm().locator('button[type="submit"], input[type="submit"]').first();
  }

  private connectedAccountButton() {
    return this.page.locator('li.is-mybrand button.MyAccount__container.is-connected');
  }

  private cookieDismissButtonCandidates(): Array<() => ReturnType<Page['locator']>> {
    const dialog = this.cookiesDialog();
    return [
      () => this.page.locator('#onetrust-reject-all-handler'),
      () => this.page.locator('#onetrust-accept-btn-handler'),
      () => dialog.getByRole('button', { name: /rejeitar os cookies/i }),
      () => dialog.getByRole('button', { name: /aceitar os cookies/i }),
      () => this.page.getByRole('button', { name: /rejeitar os cookies/i }),
      () => this.page.getByRole('button', { name: /aceitar os cookies/i }),
      () => this.page.getByRole('button', { name: /rejeitar/i }),
      () => this.page.getByRole('button', { name: /aceitar/i }),
      () => this.page.getByRole('button', { name: /recusar/i }),
    ];
  }

  private myRenaultButtonCandidates(opener: Page): Array<() => ReturnType<Page['locator']>> {
    return [
      () => opener.locator('button[data-track-button-text="My Renault"]'),
      () => opener.locator('li.is-mybrand button.MyAccount__container'),
      () => opener.locator('button.MyAccount__container'),
      () => opener.getByRole('button', { name: /my renault/i }),
      () => opener.getByText(/my renault/i).locator('xpath=ancestor::button[1]'),
    ];
  }

  // --- Helpers ---

  private ensureActivePage() {
    if (!this.page.isClosed()) return;
    const ctx = this.page.context();
    const lastOpen = [...ctx.pages()].reverse().find((p) => !p.isClosed());
    if (lastOpen) this.page = lastOpen;
  }

  private async clickFirstVisibleButton(
    candidates: Array<() => ReturnType<Page['locator']>>,
    options?: { visibleTimeoutMs?: number; clickForce?: boolean },
  ) {
    const visibleTimeoutMs = options?.visibleTimeoutMs ?? 2500;
    const clickForce = options?.clickForce ?? true;

    for (const getLocator of candidates) {
      const locator = getLocator();
      try {
        if (await locator.isVisible({ timeout: visibleTimeoutMs })) {
          await locator.click({ timeout: 5000, force: clickForce });
          return true;
        }
      } catch {
        // try next candidate
      }
    }
    return false;
  }

  private async setSensitiveInputValue(locator: ReturnType<Page['locator']>, value: string) {
    await locator.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.focus();

      // Use native value setter so frameworks (React/Vue/etc) detect the change.
      const proto = Object.getPrototypeOf(input);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(input, v);

      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  // --- Actions ---

  async goto() {
    await this.page.goto(this.url);
  }

  /**
   * "Self-healing" cookie handling: prefers stable ids first (OneTrust),
   * then falls back to role/name/text in Portuguese.
   */
  async acceptCookies() {
    // Keep this fast: try to dismiss if present, but don't "park" 10s waiting for it.
    // OneTrust often appears after load, so we retry briefly.
    const dialog = this.cookiesDialog();
    const anyOneTrustControl = this.onetrustControls();

    const deadlineMs = Date.now() + 5_000;
    let clicked = false;
    while (Date.now() < deadlineMs && !clicked) {
      clicked = await this.clickFirstVisibleButton(this.cookieDismissButtonCandidates(), {
        visibleTimeoutMs: 500,
        clickForce: true,
      });

      if (!clicked) {
        await this.page.waitForTimeout(150);
      }
    }

    // Best-effort: ensure banner/dialog is gone before proceeding (but don't block).
    if (clicked) {
      await dialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
      await anyOneTrustControl.first().waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    }
  }

  async openLogin() {
    // My Renault can either navigate in the same tab or open a new page (popup/tab).
    // Some flows also close/replace the opener during redirects; keep a stable reference.
    const context = this.page.context();
    const opener = this.page;
    const pagesBefore = new Set(context.pages());

    const deadlineMs = Date.now() + 30_000;
    let loginPage: Page | null = null;

    while (Date.now() < deadlineMs && !loginPage) {
      // Some runs (Chromium under parallel load) miss the click due to transient overlays/animations.
      // Re-try the click a few times instead of moving on and timing out in fillEmail().
      await this.clickFirstVisibleButton(this.myRenaultButtonCandidates(opener), {
        visibleTimeoutMs: 800,
        clickForce: true,
      });

      const candidates = [...context.pages()].reverse().filter((p) => !p.isClosed());

      for (const p of candidates) {
        // Find a page that actually contains the login form.
        const emailOnThisPage = p.locator(LoginPage.emailFieldSelector);
        if ((await emailOnThisPage.count().catch(() => 0)) > 0) {
          loginPage = p;
          break;
        }
      }

      // If a new page opened, prioritize it next iteration.
      if (!loginPage) {
        const newPage = [...context.pages()].reverse().find((p) => !pagesBefore.has(p) && !p.isClosed());
        if (newPage) {
          await newPage.waitForLoadState('domcontentloaded').catch(() => {});
        }
      }

      if (!loginPage) await opener.waitForTimeout(200);
    }

    if (!loginPage) {
      throw new Error('Login form did not appear after clicking "My Renault".');
    }

    this.page = loginPage;

    // If the current page got closed during redirects, pick the newest open page.
    if (this.page.isClosed()) {
      const lastOpen = [...context.pages()].reverse().find((p) => !p.isClosed());
      if (!lastOpen) throw new Error('Login page was closed during navigation.');
      this.page = lastOpen;
    }

    await this.page.waitForLoadState('domcontentloaded');
    await this.loginEmailInput().first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  async fillEmail(email: string) {
    this.ensureActivePage();
    const emailField = this.loginEmailInput().first();
    try {
      await emailField.waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      // Redirects may close/replace the page mid-flight (more common under parallel load).
      this.ensureActivePage();
      await this.loginEmailInput().first().waitFor({ state: 'visible', timeout: 30_000 });
    }
    // Avoid printing credentials in Playwright call logs (fill() logs the value).
    await this.setSensitiveInputValue(this.loginEmailInput().first(), email);
  }

  async fillPassword(password: string) {
    this.ensureActivePage();
    const passwordField = this.loginPasswordInput().first();
    try {
      await passwordField.waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      this.ensureActivePage();
      await this.loginPasswordInput().first().waitFor({ state: 'visible', timeout: 30_000 });
    }
    // Avoid printing credentials in Playwright call logs (fill() logs the value).
    await this.setSensitiveInputValue(this.loginPasswordInput().first(), password);
  }

  async submit() {
    const submitButton = this.loginSubmitButton();
    await submitButton.waitFor({ state: 'visible', timeout: 30_000 });
    await submitButton.click();
  }

  async login(email: string, password: string) {
    await this.goto();
    await this.acceptCookies();
    await this.openLogin();
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.submit();
  }

  // --- Assertions ---

  async expectLoggedIn() {
    // Under parallel load, SSO often lands on Gigya callback URLs first.
    // Only check the green-dot header after we're back on a Renault country page.
    await expect
      .poll(() => this.page.url(), { timeout: 90_000 })
      .toMatch(/renault\.[a-z.]+\/.*(verified=1|gig_actions=sso\.login)/i);

    // Ensure we're on a page that actually has the Renault header.
    if (!/renault\./i.test(this.page.url())) {
      await this.page.goto(this.url, { waitUntil: 'domcontentloaded' });
    }

    await expect(this.connectedAccountButton()).toBeVisible({ timeout: 60_000 });
  }
}
