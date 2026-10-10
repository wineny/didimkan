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

// e2e 는 커밋된 fixture.db 를 직접 쓰지 않는다(로그인·알림이 행을 쓴다). webServer.command 가 서버를 띄우기 전에
// 복사본 e2e.db 를 만든다. 모듈 최상단에서 복사하면 워커 프로세스가 설정을 다시 읽을 때 열린 DB 를 덮어쓰므로 하지 않는다.
const E2E_DB = 'data/e2e.db';

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
    command: 'cp data/fixture.db data/e2e.db && pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      TURSO_DATABASE_URL: `file:./${E2E_DB}`,
      DIDIM_ALLOW_TODAY_OVERRIDE: '1',
      DIDIM_OTP_ECHO: '1', // 인증번호를 응답에 돌려준다(로컬·CI 만, Vercel 에서는 무시)
      CRON_SECRET: 'e2e-secret',
      ...(today ? { DIDIM_TODAY: today } : {}),
    },
  },
});
