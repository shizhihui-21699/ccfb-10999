/**
 * Human operation recorder.
 *
 * Runs a HEADED Chromium, opens the harness, and records every input action the
 * operator performs into a replayable JSON trace. Usage:
 *
 *   npm run record -- tests/results/human-trace.json
 *
 * Wait for the 60s cap (or close the window) to finish. Coordinates are stored
 * relative to the 1280x800 viewport so replays stay aligned.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

interface TraceEvent {
  type: 'move' | 'down' | 'up' | 'wheel' | 'keydown' | 'keyup';
  t?: number;
  x?: number;
  y?: number;
  deltaY?: number;
  key?: string;
}

const OUT = resolve(process.cwd(), process.argv[2] || 'tests/results/human-trace.json');
const DURATION_MS = 60_000;
const VIEWPORT = { width: 1280, height: 800 };

mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({ viewport: VIEWPORT });
// Best-effort: hide the webdriver marker for the recording session itself.
await context.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true });
});

const events: TraceEvent[] = [];
const t0 = Date.now();

// Bridge + recording listeners must both exist before navigation.
await context.exposeFunction('__bgRecord', (ev: TraceEvent): void => {
  events.push({ ...ev, t: Date.now() - t0 });
});
await context.addInitScript(() => {
  const send = (e: TraceEvent): void =>
    (window as unknown as { __bgRecord: (e: TraceEvent) => void }).__bgRecord(e);
  window.addEventListener('mousemove', (e) => send({ type: 'move', x: e.clientX, y: e.clientY }), { passive: true });
  window.addEventListener('mousedown', (e) => send({ type: 'down', x: e.clientX, y: e.clientY }), { passive: true });
  window.addEventListener('mouseup', (e) => send({ type: 'up', x: e.clientX, y: e.clientY }), { passive: true });
  window.addEventListener('wheel', (e) => send({ type: 'wheel', deltaY: e.deltaY, x: e.clientX, y: e.clientY }), { passive: true });
  window.addEventListener('keydown', (e) => send({ type: 'keydown', key: e.key }), { passive: true });
  window.addEventListener('keyup', (e) => send({ type: 'keyup', key: e.key }), { passive: true });
});

const page = await context.newPage();
await page.goto('http://127.0.0.1:8790/');

console.log(`\n▶ 录制中:请在打开的浏览器里像真实用户一样操作 ${DURATION_MS / 1000}s`);
console.log('  建议动作:移动鼠标 → 点按钮 → 在输入框打字 → 滚动 → 点底部按钮\n');

await page.waitForTimeout(DURATION_MS);
writeFileSync(OUT, JSON.stringify({ version: 1, viewport: VIEWPORT, events }, null, 2));
console.log(`\n✅ 已保存 ${events.length} 个输入事件到 ${OUT}`);
await context.close();
await browser.close();
