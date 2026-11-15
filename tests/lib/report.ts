/**
 * End-to-end comparison report: runs every attacker profile plus the human
 * control group against a fresh collector, then writes a markdown + JSON
 * summary showing score, verdict and the evidence behind each decision.
 *
 *   npm run test:report
 *
 * Unlike the Playwright assertions (pass/fail gates), this is an explanatory
 * artifact for tuning thresholds and reviewing false positives.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createApp } from '../../server/src/index.ts';
import {
  botActions,
  humanLikeActions,
  syntheticActions,
  STEALTH_INIT_SCRIPT,
  MOBILE_UA_INIT_SCRIPT,
} from './helpers.ts';
import type { ScoreResult } from '../../server/src/types.ts';

const HARNESS_URL = 'http://127.0.0.1:8793/';

interface Scenario {
  id: string;
  label: string;
  group: 'bot' | 'human';
  headless: boolean;
  initScript?: string;
  actions: (page: Page) => Promise<void>;
  /** Extra init via context options, e.g. mobile emulation */
  contextOptions?: Record<string, unknown>;
}

const SCENARIOS: Scenario[] = [
  { id: 'S1', label: '原生 headless + 标准脚本', group: 'bot', headless: true, actions: botActions },
  { id: 'S2', label: 'headless + stealth 补丁', group: 'bot', headless: true, initScript: STEALTH_INIT_SCRIPT, actions: botActions },
  { id: 'S3', label: 'headless + 类人贝塞尔操作', group: 'bot', headless: true, actions: humanLikeActions },
  { id: 'S4', label: 'headed + 标准 Playwright 操作', group: 'bot', headless: false, actions: botActions },
  { id: 'S5', label: 'headed + dispatchEvent 合成事件', group: 'bot', headless: false, actions: syntheticActions },
  { id: 'S6', label: 'headless + 伪装 iPhone UA', group: 'bot', headless: true, initScript: MOBILE_UA_INIT_SCRIPT, actions: botActions },
  {
    id: 'S7',
    label: 'headless + 自动化框架全局变量',
    group: 'bot',
    headless: true,
    initScript: 'window.callSelenium=()=>{};window.__nightmare={};document.$chrome_asyncScriptInfo={};',
    actions: botActions,
  },
  {
    id: 'S8',
    label: 'headless 静默无操作 9s',
    group: 'bot',
    headless: true,
    actions: async (page) => page.waitForTimeout(9000),
  },
  {
    id: 'H1',
    label: 'headed 类人操作 + 隐藏 webdriver(对照)',
    group: 'human',
    headless: false,
    initScript: "Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>undefined,configurable:true});",
    actions: humanLikeActions,
  },
];

interface Row {
  scenario: Scenario;
  result: ScoreResult;
}

async function runOne(browsers: { headless: Browser; headed: Browser }, s: Scenario): Promise<ScoreResult> {
  // headless is a launch-time property in Playwright; context options cannot
  // override it, so human scenarios must use the separately launched headed browser.
  const browser = s.headless ? browsers.headless : browsers.headed;
  const context = await browser.newContext({
    // Explicit screen larger than the viewport: real desktops reserve space
    // for menu bar / dock; Playwright otherwise sizes screen == viewport.
    viewport: { width: 1100, height: 720 },
    screen: { width: 1440, height: 900 },
    ...(s.contextOptions ?? {}),
  });
  if (s.initScript) await context.addInitScript(s.initScript);
  const page = await context.newPage();
  await page.goto(HARNESS_URL);
  await page.waitForTimeout(1200);
  await s.actions(page);
  const sessionId = await page.evaluate(() => window.BotGuard!.getSessionId());
  await page.evaluate(() => window.__bgFlush());
  await page.waitForTimeout(600);
  const res = await fetch(`http://127.0.0.1:8793/api/results/${encodeURIComponent(sessionId)}`);
  const body = (await res.json()) as { reports: Array<{ result: ScoreResult }> };
  await context.close();
  return body.reports.at(-1)!.result;
}

function toMarkdown(rows: Row[]): string {
  const lines: string[] = [];
  lines.push('# BotGuard 对照实验报告');
  lines.push('');
  lines.push(`生成时间:${new Date().toISOString()}`);
  lines.push('');
  lines.push('| 场景 | 分组 | 总分 | 判定 | 无头(≤45) | 自动化(≤30) | 矛盾(≤20) | 行为(≤20) | 命中规则数 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const { scenario, result } of rows) {
    const c = Object.fromEntries(result.categories.map((x) => [x.category, x.capped]));
    lines.push(
      `| ${scenario.id} ${scenario.label} | ${scenario.group === 'bot' ? '机器人' : '真人'} | ${result.score} | **${result.verdict}** | ${c.headless ?? 0} | ${c.automation ?? 0} | ${c.contradiction ?? 0} | ${c.behavior ?? 0} | ${result.evidence.length} |`,
    );
  }
  lines.push('');
  lines.push('## 逐场景证据解释');
  for (const { scenario, result } of rows) {
    lines.push('');
    lines.push(`### ${scenario.id} ${scenario.label} → ${result.verdict.toUpperCase()} (${result.score} 分)`);
    for (const cat of result.categories) {
      if (!cat.evidence.length) continue;
      lines.push(`- **${cat.label}**(贡献 ${cat.capped}/${cat.cap})`);
      for (const e of cat.evidence) {
        const sign = e.weight >= 0 ? `+${e.weight}` : `${e.weight}`;
        lines.push(`  - \`${e.id}\` ${sign} — ${e.reason}`);
        lines.push(`    - observed: \`${JSON.stringify(e.observed).slice(0, 160)}\``);
      }
    }
    if (result.humanSignals.length) {
      lines.push(`- 人类信号:${result.humanSignals.map((e) => `${e.id}(${e.weight})`).join(', ')}`);
    }
  }
  return lines.join('\n');
}

const server = createApp().listen(8793, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const headlessBrowser = await chromium.launch({ headless: true });
// Real headed browser: headless-ness is fixed at launch, and only a true
// headed window produces the benign signals (normal UA, window.chrome, plugins).
const headedBrowser = await chromium.launch({ headless: false });
const browsers = { headless: headlessBrowser, headed: headedBrowser };
const rows: Row[] = [];
for (const s of SCENARIOS) {
  process.stdout.write(`运行 ${s.id} ${s.label} … `);
  const result = await runOne(browsers, s);
  console.log(`${result.verdict} (${result.score})`);
  rows.push({ scenario: s, result });
}
await headlessBrowser.close();
await headedBrowser.close();
server.close();

const outDir = resolve(process.cwd(), 'tests/results');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'comparison-report.md'), toMarkdown(rows));
writeFileSync(resolve(outDir, 'comparison-report.json'), JSON.stringify(rows.map((r) => ({ scenario: r.scenario.id, label: r.scenario.label, group: r.scenario.group, result: r.result })), null, 2));

// Confusion matrix over expected groups.
const bots = rows.filter((r) => r.scenario.group === 'bot');
const humans = rows.filter((r) => r.scenario.group === 'human');
const detected = bots.filter((r) => r.result.verdict !== 'human').length;
const falsePos = humans.filter((r) => r.result.verdict !== 'human').length;
console.log('\n──────── 汇总 ────────');
console.log(`机器人场景检出 ${detected}/${bots.length}(含 suspect)`);
console.log(`真人场景误报 ${falsePos}/${humans.length}`);
console.log(`报告已写入 tests/results/comparison-report.md`);
