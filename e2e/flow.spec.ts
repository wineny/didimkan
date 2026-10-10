import { expect, test } from '@playwright/test';
import { bodyFontSize, hasHorizontalOverflow, loadFixtureIds, setBig } from './helpers';

const shot = (n: string) => `e2e/shots/${n}.png`;

test('① 상태 선택(기본 2단) → 동네 → 홈: 지금 칸 2단, 강좌 카드 1개 이상', async ({ page }) => {
  const ids = loadFixtureIds();
  await page.goto('/');
  await expect(page.locator('[data-choice]')).toHaveCount(3);
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
  const paths = ['/', `/where?${q}`, `/home?${q}`, `/course/${ids.ids?.["9632"] ?? "9632"}?${q}`];
  for (const big of [false, true]) {
    for (const p of paths) {
      await page.goto(p);
      await setBig(page, big);
      expect(await hasHorizontalOverflow(page), `${p} big=${big}`).toBe(false);
    }
  }
});

test('⑥ 알림 버튼 → 바텀시트 「접수 알림은 11월에 열려요」', async ({ page }) => {
  const ids = loadFixtureIds();
  await page.goto(`/course/${ids.ids?.["9632"] ?? "9632"}?st=2&sido=${ids.sido ?? ''}&sigungu=${ids.sigungu ?? ''}`);
  await page.locator('[data-notify]').click();
  const sheet = page.locator('[role=dialog][data-sheet]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('접수 알림은 11월에 열려요');
  await page.screenshot({ path: shot('06') });
});
