import { Page, expect } from '@playwright/test';

export class LoginPage {
  private page: Page;
  private readonly url = 'https://www.renault.pt/';

  constructor(page: Page) {
    this.page = page;
  }

  private ensureActivePage() {
    if (!this.page.isClosed()) return;
    const ctx = this.page.context();
    const lastOpen = [...ctx.pages()].reverse().find((p) => !p.isClosed());
    if (lastOpen) this.page = lastOpen;
  }

  async goto() {
    await this.page.goto(this.url);
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

  /**
   * "Self-healing" cookie handling: prefers stable ids first (OneTrust),
   * then falls back to role/name/text in Portuguese.
   */
  async acceptCookies() {
    // Keep this fast: try to dismiss if present, but don't "park" 10s waiting for it.
    // OneTrust often appears after load, so we retry briefly.
    const dialog = this.page.getByRole('dialog', { name: /cookies|Funcionamento dos cookies/i });
    const anyOneTrustControl = this.page.locator('[id^="onetrust-"]');

    const deadlineMs = Date.now() + 5_000;
    let clicked = false;
    while (Date.now() < deadlineMs && !clicked) {
      clicked = await this.clickFirstVisibleButton(
        [
          // OneTrust ids (most stable)
          () => this.page.locator('#onetrust-reject-all-handler'),
          () => this.page.locator('#onetrust-accept-btn-handler'),

          // Buttons inside the cookies dialog (matches your snapshot)
          () => dialog.getByRole('button', { name: /rejeitar os cookies/i }),
          () => dialog.getByRole('button', { name: /aceitar os cookies/i }),

          // Global fallbacks
          () => this.page.getByRole('button', { name: /rejeitar os cookies/i }),
          () => this.page.getByRole('button', { name: /aceitar os cookies/i }),
          () => this.page.getByRole('button', { name: /rejeitar/i }),
          () => this.page.getByRole('button', { name: /aceitar/i }),
          () => this.page.getByRole('button', { name: /recusar/i }),
        ],
        { visibleTimeoutMs: 500, clickForce: true },
      );

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

    const myRenaultButtonCandidates = [
      () => opener.locator('button[data-track-button-text="My Renault"]'),
      () => opener.locator('li.is-mybrand button.MyAccount__container'),
      () => opener.locator('button.MyAccount__container'),
      () => opener.getByRole('button', { name: /my renault/i }),
      () => opener.getByText(/my renault/i).locator('xpath=ancestor::button[1]'),
    ];

    const deadlineMs = Date.now() + 30_000;
    let loginPage: Page | null = null;

    while (Date.now() < deadlineMs && !loginPage) {
      // Some runs (Chromium under parallel load) miss the click due to transient overlays/animations.
      // Re-try the click a few times instead of moving on and timing out in fillEmail().
      await this.clickFirstVisibleButton(myRenaultButtonCandidates, { visibleTimeoutMs: 800, clickForce: true });

      // Find a page that actually contains the login form.
      const candidates = [...context.pages()].reverse().filter((p) => !p.isClosed());

      for (const p of candidates) {
        const emailOnThisPage = p.locator(
          'input[name="phoneOrEmail"], input[name="email"], input[type="email"], input[autocomplete="username"]',
        );
        if ((await emailOnThisPage.count().catch(() => 0)) > 0) {
          loginPage = p;
          break;
        }
      }

      // If a new page opened, prioritize it next iteration.
      if (!loginPage) {
        const newPage = [...context.pages()].reverse().find((p) => !pagesBefore.has(p) && !p.isClosed());
        if (newPage) {
          // short settle time
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

  private loginEmailInput() {
    // Language-agnostic (based on stable `name` attributes on ID Connect / My Renault)
    return this.page.locator(
      'input[name="phoneOrEmail"], input[name="email"], input[type="email"], input[autocomplete="username"]',
    );
  }

  private loginPasswordInput() {
    return this.page.locator('input[name="password"][type="password"], input[type="password"], input[autocomplete="current-password"]');
  }

  private loginForm() {
    // Scope submit button to the form containing the email field to avoid picking unrelated submit buttons.
    return this.loginEmailInput().first().locator('xpath=ancestor::form[1]');
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
    const submitButton = this.loginForm().locator('button[type="submit"], input[type="submit"]').first();
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

    const connectedIcon = this.page.locator('li.is-mybrand button.MyAccount__container.is-connected');
    await expect(connectedIcon).toBeVisible({ timeout: 60_000 });
  }
}
