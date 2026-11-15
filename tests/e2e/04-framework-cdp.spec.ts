import { test, expect } from 'playwright/test';
import { HARNESS, humanLikeActions, flushAndGetResults, type StoredReport } from '../lib/helpers.ts';

/**
 * Two more attacker profiles:
 *  D1: framework globals left on window (Selenium/Puppeteer cleanup failure)
 *  D2: CDP-driven input in a headed browser, where the driver tries to behave
 *      human but the protocol-level webdriver flag still betrays it.
 */
test.describe('框架泄露与 CDP 场景', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'headless', '本组仅在 headless 项目运行');
  });

  test('D1 页面存在自动化框架残留全局变量 → AUTO_GLOBALS_LEAK 命中', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      // Realistic leftovers seen in the wild: callSelenium_, domAutomation,
      // $chrome_asyncScriptInfo, __nightmare …
      (window as unknown as Record<string, unknown>).callSelenium = () => 'noop';
      (window as unknown as Record<string, unknown>).domAutomation = true;
      (window as unknown as Record<string, unknown>).__nightmare = { running: true };
      (document as unknown as Record<string, unknown>).$chrome_asyncScriptInfo = { seq: 1 };
    });
    const page = await context.newPage();
    await page.goto(HARNESS);
    await page.waitForTimeout(1200);
    await humanLikeActions(page);
    const results = await flushAndGetResults(page);

    const last = results.at(-1) as StoredReport;
    const ids = last.evidence.map((e) => e.id);
    expect(ids).toContain('AUTO_GLOBALS_LEAK');
    expect(last.verdict).not.toBe('human');
    await context.close();
  });

  test('D2 CDP 新建会话(playwright 默认通道)→ webdriver 标记可被采集', async ({ browser }) => {
    // Playwright talks CDP under the hood; creating a plain context still
    // exposes navigator.webdriver=true in Chromium, which the SDK must catch.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(HARNESS);
    await page.waitForTimeout(1200);
    await humanLikeActions(page);
    const results = await flushAndGetResults(page);

    const last = results.at(-1) as StoredReport;
    const ids = last.evidence.map((e) => e.id);
    expect(ids).toContain('HEADLESS_WEBDRIVER');
    await context.close();
  });
});
