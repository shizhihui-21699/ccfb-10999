import { test, expect } from 'playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HARNESS, humanLikeActions, flushAndGetResults, type StoredReport } from '../lib/helpers.ts';
import { loadTrace, replayTrace } from '../lib/replayer.ts';

/**
 * Human control group.
 *  HUM-1: programmatic human-like behavior (Bezier paths, jittered rhythm) in
 *         a headed browser with automation flags suppressed. This exercises
 *         the negative-weight "human signal" rules and guards against false
 *         positives.
 *  HUM-2: replay of a real recorded trace, if one exists under
 *         tests/results/human-trace.json (created via `npm run record`).
 */
test.describe('真人对照组', () => {
  test('HUM-1 类人操作 + 反自动化标记 → 分数应明显低于 bot 阈值', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'headed', '真人对照仅在 headed 项目运行');
    const context = await browser.newContext({
      viewport: { width: 1100, height: 720 },
      screen: { width: 1440, height: 900 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    });
    const page = await context.newPage();
    await page.goto(HARNESS);
    await page.waitForTimeout(1200);
    await humanLikeActions(page);
    const results = await flushAndGetResults(page);

    const last = results.at(-1) as StoredReport;
    // webdriver 被隐藏后,环境信号接近真人;行为规则应给出人类负权重
    expect(last.score).toBeLessThan(60);
    const beh = last.categories.find((c) => c.category === 'behavior')!;
    // 行为分类的原始合计可能为负(人类信号抵消),封顶后为 0
    expect(beh.raw).toBeLessThanOrEqual(0);
    await context.close();
  });

  const tracePath = resolve(process.cwd(), 'tests/results/human-trace.json');

  test('HUM-2 回放真人录制轨迹 → 行为分类不产生机器人证据', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'headed', '真人对照仅在 headed 项目运行');
    test.skip(!existsSync(tracePath), '先运行 npm run record 生成 tests/results/human-trace.json');
    const trace = loadTrace('tests/results/human-trace.json');
    const context = await browser.newContext({
      viewport: { width: trace.viewport.w, height: trace.viewport.h },
    });
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    });
    const page = await context.newPage();
    await page.goto(HARNESS);
    await page.waitForTimeout(800);
    await replayTrace(page, trace);
    await page.waitForTimeout(800);
    const results = await flushAndGetResults(page);

    const last = results.at(-1) as StoredReport;
    const behEvidence = last.evidence.filter((e) => e.category === 'behavior' && e.weight > 0);
    expect(behEvidence).toEqual([]);
    expect(last.dataQuality.behaviorInsufficient).toBe(false);
    await context.close();
  });
});
