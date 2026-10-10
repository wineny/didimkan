import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export type FixtureIds = {
  today?: string;
  sido?: string;
  sigungu?: string;
  [key: string]: unknown;
};

// R12: 테스트 함수 안에서 호출한다. A7 이 파일을 만들기 전에도 --list 가 된다.
export function loadFixtureIds(): FixtureIds {
  return JSON.parse(readFileSync(join(__dirname, 'fixture-ids.json'), 'utf8'));
}

export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

export async function bodyFontSize(page: Page): Promise<number> {
  const el = page.locator('main p').first();
  const target = (await el.count()) > 0 ? el : page.locator('main').first();
  return target.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
}

export async function setBig(page: Page, on: boolean): Promise<void> {
  const isOn = await page.evaluate(() => document.documentElement.hasAttribute('data-big'));
  if (isOn !== on) await page.locator('[data-big-toggle]').first().click();
}
