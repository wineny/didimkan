import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { bodyFontSize, hasHorizontalOverflow, loadFixtureIds, setBig } from './helpers';

const shot = (n: string) => `e2e/shots/${n}.png`;

test('① 상태 선택(기본 2단) → 동네 → 홈: 지금 칸 2단, 강좌 카드 1개 이상', async ({ page }) => {
  const ids = loadFixtureIds();
  await page.goto('/');
  // 첫 방문: 소개 → 시작하기 → 상태 질문. 다시 열면 소개 없이 바로 질문
  await expect(page.locator('[data-intro-start]')).toBeVisible();
  await expect(page.locator('[data-choice]').first()).toBeHidden();
  await page.locator('[data-intro-start]').click();
  await expect(page.locator('[data-choice]')).toHaveCount(3);
  await expect(page.locator('[data-choice]').first()).toBeVisible();
  await expect(page.locator('[data-choice="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-big-toggle]').first()).toBeVisible();
  await page.screenshot({ path: shot('01') });
  await page.locator('[data-next]').click();
  await expect(page).toHaveURL(/\/where/);
  await page.locator(`[data-sido="${ids.sido}"]`).click();
  await page.locator(`[data-sigungu="${ids.sigungu}"]`).click();
  await page.locator('[data-next]').click();
  await expect(page).toHaveURL(/\/home\?.*st=2/);
  await page.screenshot({ path: shot('02') });
  await expect(page.locator('[data-step]')).toHaveCount(3);
  await expect(page.locator('[data-step="2"]')).toHaveAttribute('data-now', 'true');
  expect(await page.locator('[data-course]').count()).toBeGreaterThanOrEqual(1);
});

test('② 「집에서」 선택 시 1단, /where 에 「동네는 건너뛰기」, 홈 st=1', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-intro-start]').click();
  await page.locator('[data-choice="1"]').click();
  await expect(page.locator('[data-choice="1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-next]').click();
  await expect(page).toHaveURL(/\/where/);
  await expect(page.getByText('동네는 건너뛰기')).toBeVisible();
  await page.getByText('동네는 건너뛰기').click();
  await expect(page).toHaveURL(/\/home\?.*st=1/);
});

test('③ 강좌 카드: 신호 타일 6개, 외부 신청 링크, 전화 버튼', async ({ page }) => {
  const ids = loadFixtureIds();
  await page.goto(`/course/${ids.ids?.["9632"] ?? "9632"}?st=2&sido=${ids.sido ?? ''}&sigungu=${ids.sigungu ?? ''}`);
  await expect(page.locator('[data-tile]')).toHaveCount(6);
  const apply = page.locator('a[data-apply]');
  await expect(apply).toHaveAttribute('target', '_blank');
  await expect(apply).toHaveAttribute('rel', /noopener/);
  await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
  await page.screenshot({ path: shot('03') });
});

test('④ 크게 보기: 새로고침 뒤 유지, 글자 1.4배↑, 버튼 64px↑, 홈 2단', async ({ page }) => {
  const ids = loadFixtureIds();
  const home = `/home?st=2&sido=${ids.sido ?? ''}&sigungu=${ids.sigungu ?? ''}`;
  await page.goto(home);
  const before = await bodyFontSize(page);
  await setBig(page, true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-big', /.*/);
  expect(await bodyFontSize(page)).toBeGreaterThanOrEqual(before * 1.4);
  const h = await page.locator('main a[role="button"], main button, main a[data-apply]').first().evaluate((n) => n.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(64);
  await expect(page.locator('[data-step]')).toHaveCount(2);
  await page.screenshot({ path: shot('04') });
});

test('⑤ 390px 가로 넘침 0: 4화면 × 일반·크게', async ({ page }) => {
  const ids = loadFixtureIds();
  const q = `st=2&sido=${ids.sido ?? ''}&sigungu=${ids.sigungu ?? ''}`;
  const paths = ['/', `/where?${q}`, `/home?${q}`, `/course/${ids.ids?.["9632"] ?? "9632"}?${q}`, '/login', '/privacy', '/about'];
  for (const big of [false, true]) {
    for (const p of paths) {
      await page.goto(p);
      await setBig(page, big);
      expect(await hasHorizontalOverflow(page), `${p} big=${big}`).toBe(false);
    }
  }
});

// ── M2-a: 로그인 → 관심 등록·접수 알림 → 내 알림 → 크론 → 번호 지우기 ──
// 한 컨텍스트를 같이 써서 로그인 상태를 이어 간다(테스트마다 다시 로그인하면 OTP 제한 10분 3회에 걸린다).
test.describe.serial('M2 알림', () => {
  let ctx: BrowserContext;
  let page: Page;
  let alertUrl = '';

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext();
    page = await ctx.newPage();
  });
  test.afterAll(async () => {
    await ctx.close();
  });

  test('⑥ 접수 전 강좌 → 알림 버튼 → 로그인(번호·6자리) → 등록 화면', async () => {
    const ids = loadFixtureIds();
    const q = `st=2&sido=${ids.sido ?? ''}&sigungu=${ids.sigungu ?? ''}`;
    // 10132 는 접수 06-01(before). 9632 는 접수 중(open)이라 버튼이 없어야 한다.
    await page.goto(`/course/${ids.ids?.["9632"] ?? "9632"}?${q}`);
    await expect(page.locator('[data-notify]')).toHaveCount(0);
    await expect(page.locator('[data-login]')).toBeVisible();

    await page.goto(`/course/${ids.ids?.["10132"] ?? "10132"}?${q}`);
    await page.locator('[data-notify]').click();
    await expect(page).toHaveURL(/\/login\?/);
    await page.locator('[data-phone]').fill('01012345678');
    const sendRes = page.waitForResponse((r) => r.url().includes('/api/auth/send-code'));
    await page.locator('[data-send]').click();
    const body = (await (await sendRes).json()) as { ok: boolean; devCode?: string };
    expect(body.ok).toBe(true);
    expect(body.devCode).toMatch(/^\d{6}$/);
    await page.locator('[data-code]').fill(body.devCode!);
    await page.locator('[data-verify]').click();
    await expect(page).toHaveURL(/\/alert\/[0-9a-f-]+$/);
    alertUrl = new URL(page.url()).pathname;
    // 클라이언트 이동 뒤 Next 의 route announcer 가 h1 글자를 한 번 더 읽으므로 제목 역할로 찾는다.
    await expect(page.getByRole('heading', { name: '관심 강좌로 등록했어요' })).toBeVisible();
    await expect(page.getByText('접수 3일 전 문자')).toBeVisible();
    await expect(page.getByText('접수 당일 문자')).toBeVisible();
    await expect(page.locator('[data-me]')).toBeVisible();
    await page.screenshot({ path: shot('06') });
  });

  test('⑦ 내 알림: 카드 1개, 끄기/켜기, 문자 미리보기', async () => {
    await page.locator('[data-done]').click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.locator('[data-alert]')).toHaveCount(1);
    await expect(page.getByText('남은 문자')).toBeVisible();
    await page.locator('[data-alert-toggle]').first().click();
    await expect(page.locator('[data-alert]').first()).toContainText('꺼짐');
    await page.locator('[data-alert-toggle]').first().click();
    await expect(page.locator('[data-alert]').first()).not.toContainText('꺼짐');
    await page.screenshot({ path: shot('08') });

    await page.goto(`${alertUrl}/sms`);
    await expect(page.getByText('[디딤칸]')).toHaveCount(2);
    await page.screenshot({ path: shot('09') });
  });

  test('⑦-2 로그인 화면들 390px 가로 넘침 0 · 크게 보기 버튼·입력 64px↑', async () => {
    const pages = ['/me', alertUrl, `${alertUrl}/sms`, '/login'];
    for (const big of [false, true]) {
      for (const p of pages) {
        await page.goto(p);
        await setBig(page, big);
        expect(await hasHorizontalOverflow(page), `${p} big=${big}`).toBe(false);
        if (big) {
          // 누르는 것(버튼·CTA·입력)이 있는 화면만 잰다. 없는 화면에서 기다리다 멈추지 않게 count 로 먼저 본다.
          const targets = page.locator('main button, main a.cta, main a.sbtn, main input');
          // 문자 미리보기(/sms)는 본문에 누를 것이 없다(뒤로 가기는 머리띠에 있음).
          if ((await targets.count()) > 0) {
            const h = await targets.first().evaluate((el) => el.getBoundingClientRect().height);
            expect(h, `${p} 첫 버튼/입력 높이`).toBeGreaterThanOrEqual(64);
          }
        }
      }
    }
    await setBig(page, false);
  });

  test('⑧ 크론: 당일 아침 창에만 d0, 인증 없으면 401', async () => {
    // 다이어트댄스1반(강남): 접수 시작 2026-04-26 = fixture today. 브라우저 쿠키로 알림을 하나 더 만든다.
    const made = await page.request.post('/api/alerts', { data: { courseId: '282281ec6157aec2' } });
    expect(made.ok()).toBe(true);
    const auth = { Authorization: 'Bearer e2e-secret' };
    const inWindow = await page.request.get('/api/cron/notify?dry=1&now=2026-04-26T08:30', { headers: auth });
    expect(inWindow.status()).toBe(200);
    const planned = ((await inWindow.json()) as { planned: { kind: string }[] }).planned;
    expect(planned.some((p) => p.kind === 'd0')).toBe(true);
    const early = await page.request.get('/api/cron/notify?dry=1&now=2026-04-26T07:30', { headers: auth });
    expect(((await early.json()) as { planned: unknown[] }).planned).toHaveLength(0);
    const noAuth = await page.request.get('/api/cron/notify?dry=1');
    expect(noAuth.status()).toBe(401);
  });

  test('⑨ 내 번호 지우기 → 로그아웃 상태, /me 는 로그인으로', async () => {
    await page.goto('/me');
    await expect(page.locator('[data-alert]')).toHaveCount(2);
    await page.locator('[data-delete-me]').click();
    await page.locator('[data-delete-confirm]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-login]')).toBeVisible();
    await page.goto('/me');
    await expect(page).toHaveURL(/\/login/);
  });
});
