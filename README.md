## CaseStudyAutomotive

This project runs an automated browser test that logs in to the Renault “My Renault” site and confirms you are signed in.

## Prerequisites

You need:

- Node.js installed (this lets you run `npm` and `npx` commands).
- (Recommended) Git installed (so you can clone the repository).

## Setup on Windows (PowerShell)

### 1) Install Node.js

1. Install the **Node.js LTS** version from the official Node.js website.
2. After installing, open a new PowerShell window (important).

Quick check:

```powershell
node -v
npm -v
```

### 2) Clone the repository

In PowerShell, run:

```powershell
git clone https://github.com/Bilenh/CaseStudyAutomotive.git
cd CaseStudyAutomotive
```

If you do not have Git installed, you can still download the repository as a ZIP file from GitHub, then extract it and open PowerShell in the extracted folder.

### 3) Install project dependencies

From the `CaseStudyAutomotive` folder, run:

```powershell
npm install
```

### 4) Install Playwright browser downloads

Playwright needs to download browser binaries (Chromium, Firefox, WebKit):

```powershell
npx playwright install
```

### 5) Confirm the environment file (login info)

The test reads login settings from:

- `env/.env.staging`

Open `env/.env.staging` and confirm it contains:

- `TEST_USER_EMAIL=...`
- `TEST_USER_PASSWORD=...`
- `BASE_URL=...`

If the file already exists (it should be in this repo), you can usually leave it as-is. Only update it if you want to use different credentials.

Important: do not share passwords publicly.

## Run the tests

From the project folder, run:

```powershell
npx playwright test
```

## View the test results (HTML report)

After the run finishes, open the report in your browser:

- `playwright-report/index.html`

If you want to open it quickly from PowerShell:

```powershell
start playwright-report\index.html
```

## If something fails (common errors)

- `Missing BASE_URL` or `Missing TEST_USER_EMAIL / TEST_USER_PASSWORD`
  - Means `env/.env.staging` is missing or not set correctly.
- The login test can fail if the website blocks automated logins or if the site changes.
- If the report HTML does not appear, the test likely crashed early. Re-check the terminal output for the first error message.

