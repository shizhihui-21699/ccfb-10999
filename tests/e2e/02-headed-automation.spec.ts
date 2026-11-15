import { test, expect, type Page } from 'playwright/test';
import { HARNESS, botActions, flushAndGetResults, syntheticActions, type StoredReport } from '../lib/helpers.ts';

async function runScenario(page: Page, actions: (p: Page) => Promise<void>): Promise<StoredReport[]> {
  await page.goto(HARNESS);
  await page.waitForTimeout(1200);
  await actions(page);
  return flushAndGetResults(page);
}

test.describe('有头浏览器下的自动化框架识别', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'headed', '本组仅在 headed 项目运行');
  });

  test('A1 headed + Playwright 标准操作 → webdriver 泄露,至少 suspect', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const results = await runScenario(page, botActions);

    const last = results.at(-1)!;
    expect(['bot', 'suspect']).toContain(last.verdict);
    const ids = last.evidence.map((e) => e.id);
    expect(ids).toContain('HEADLESS_WEBDRIVER');
    await context.close();
  });

  test('A2 headed + dispatchEvent 合成事件 → isTrusted 规则全部命中', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const results = await runScenario(page, syntheticActions);

    const last = results.at(-1)!;
    expect(last.verdict).toBe('bot');
    const ids = last.evidence.map((e) => e.id);
    expect(ids).toContain('AUTO_MOUSE_UNTRUSTED');
    expect(ids).toContain('AUTO_CLICK_UNTRUSTED');
    expect(ids).toContain('AUTO_SCROLL_UNTRUSTED');
    // 合成事件节奏机械,行为类规则也应有命中
    expect(ids.some((id) => id.startsWith('BEH_'))).toBe(true);
    await context.close();
  });

  test('A3 headed 无操作静默 8s+ → 无输入长会话规则命中', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(HARNESS);
    // 超过规则要求的 8000ms 静默窗口
    await page.waitForTimeout(9000);
    const results = await flushAndGetResults(page);

    const last = results.at(-1)!;
    const ids = last.evidence.map((e) => e.id);
    expect(ids).toContain('BEH_NO_INPUT_LONG_SESSION');
    await context.close();
  });
});
