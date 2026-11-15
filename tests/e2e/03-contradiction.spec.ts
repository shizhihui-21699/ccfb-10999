import { test, expect, devices } from 'playwright/test';
import {
  HARNESS,
  flushAndGetResults,
  MOBILE_UA_INIT_SCRIPT,
  botActions,
  type StoredReport,
} from '../lib/helpers.ts';

test.describe('环境信号矛盾识别', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'headless', '本组仅在 headless 项目运行');
  });

  test('C1 桌面浏览器伪装 iPhone UA,却没有触摸能力 → 移动UA无触摸矛盾', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(MOBILE_UA_INIT_SCRIPT);
    const page = await context.newPage();
    await page.goto(HARNESS);
    await page.waitForTimeout(1200);
    await botActions(page);
    const results = await flushAndGetResults(page);

    const last = results.at(-1) as StoredReport;
    const ids = last.evidence.map((e) => e.id);
    expect(ids).toContain('CONTRA_MOBILE_UA_NO_TOUCH');
    // 矛盾分类必须贡献了分数
    const contra = last.categories.find((c) => c.category === 'contradiction')!;
    expect(contra.capped).toBeGreaterThan(0);
    await context.close();
  });

  test('C2 Playwright 移动模拟(iPhone 14,含触摸)→ 不应触发移动UA无触摸误报', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['iPhone 14'] });
    const page = await context.newPage();
    await page.goto(HARNESS);
    await page.waitForTimeout(1200);
    // 真实触摸:tap 而不是 mouse click
    await page.locator('#claim').tap();
    await page.locator('#phone').tap();
    await page.locator('#phone').fill('13800138000');
    await page.waitForTimeout(800);
    const results = await flushAndGetResults(page);

    const last = results.at(-1) as StoredReport;
    const ids = last.evidence.map((e) => e.id);
    expect(ids).not.toContain('CONTRA_MOBILE_UA_NO_TOUCH');
    expect(ids).not.toContain('CONTRA_TOUCH_FLAGS_SPLIT');
    await context.close();
  });
});
