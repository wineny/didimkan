import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// R3: fixture-ids.json 의 today 를 앱 기준일로 넘긴다. 파일이 없으면 생략.
function fixtureToday(): string | undefined {
  try {
    const ids = JSON.parse(readFileSync('e2e/fixture-ids.json', 'utf8'));
    return typeof ids.today === 'string' ? ids.today : undefined;
  } catch {
    return undefined;
  }
}

const today = fixtureToday();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ko-KR',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR' } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      TURSO_DATABASE_URL: 'file:./data/fixture.db',
      ...(today ? { DIDIM_TODAY: today, DIDIM_ALLOW_TODAY_OVERRIDE: '1' } : {}),
    },
  },
});
