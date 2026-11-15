import { test, expect, type Page } from 'playwright/test';
import { HARNESS, botActions, flushAndGetResults, humanLikeActions, STEALTH_INIT_SCRIPT, type StoredReport } from '../lib/helpers.ts';

async function runScenario(page: Page, actions: (p: Page) => Promise<void>): Promise<StoredReport[]> {
  await page.goto(HARNESS);
  // Let the SDK's idle-time env probes complete.
  await page.waitForTimeout(1200);
  await actions(page);
  return flushAndGetResults(page);
}

test.describe('无头浏览器识别', () => {
  test.beforeEach(async ({}, testInfo) => {
    testInfo.skip(testInfo.project.name !== 'headless', '本组仅在 headless 项目运行');
  });

  test('H1 原生 headless + 标准脚本操作 → 必须判 bot', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const results = await runScenario(page, botActions);

    expect(results.length).toBeGreaterThan(0);
    const last = results.at(-1)!;
    expect(last.verdict).toBe('bot');
    // 无头分类必须打满或接近打满;bot 也可能由高置信度硬判定触发
    const headless = last.categories.find((c) => c.category === 'headless')!;
    expect(headless.capped).toBeGreaterThanOrEqual(40);
    // 解释性:至少能看到无头类证据
    const ids = last.evidence.map((e) => e.id);
    expect(ids.some((id) => id.startsWith('HEADLESS_'))).toBe(true);
    await context.close();
  });

  test('H2 headless + stealth 补丁伪装 → 仍应判 bot/suspect,且发现伪装矛盾', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    const page = await context.newPage();
    const results = await runScenario(page, botActions);

    const last = results.at(-1)!;
    expect(['bot', 'suspect']).toContain(last.verdict);
    const ids = last.evidence.map((e) => e.id);
    // 补丁让 webdriver getter 非原生 → 伪装痕迹规则必须命中
    expect(ids).toContain('CONTRA_WEBDRIVER_HIDDEN_BADLY');
    // 攻击者留下的自动化全局变量被捕获
    expect(ids).toContain('AUTO_GLOBALS_LEAK');
    await context.close();
  });

  test('H3 headless + 类人贝塞尔操作 → 环境证据独立成立,仍判 bot/suspect', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const results = await runScenario(page, humanLikeActions);

    const last = results.at(-1)!;
    // 行为可以很像人,但 headless 的环境指纹不会因此消失
    expect(['bot', 'suspect']).toContain(last.verdict);
    const headless = last.categories.find((c) => c.category === 'headless')!;
    expect(headless.capped).toBeGreaterThan(0);
    await context.close();
  });
});
