/**
 * Shared interaction scripts for the detection testbed.
 *
 * Three interaction "personalities":
 *  - botActions:        what a stock automation script does — fill/click/scroll
 *                       with Playwright's trusted (isTrusted=true) events
 *  - humanLikeActions:  Bezier mouse paths, jittered typing, pauses, wheel scroll
 *  - syntheticActions:  page.evaluate dispatchEvent — isTrusted always false
 */
import type { Page, Locator } from 'playwright';

export const HARNESS = '/';

/** Pseudo-random in a fixed range; Math.random is fine in the test driver. */
const rnd = (min: number, max: number): number => min + Math.random() * (max - min);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Cubic Bezier point at t, used to bend straight A→B paths like a wrist. */
function bezier(p0: number[], p1: number[], p2: number[], p3: number[], t: number): number[] {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  return [
    uu * u * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + tt * t * p3[0],
    uu * u * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + tt * t * p3[1],
  ];
}

/** Move the mouse from its current spot to the target along a curved path. */
export async function humanMouseMove(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('target not visible');
  const start = await page.evaluate(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 3 }));
  const tx = box.x + box.width / 2 + rnd(-4, 4);
  const ty = box.y + box.height / 2 + rnd(-3, 3);
  const steps = 22 + Math.floor(rnd(0, 10));
  const p1 = [start.x + rnd(40, 140), start.y + rnd(-60, 80)];
  const p2 = [tx - rnd(40, 140), ty + rnd(-60, 60)];
  for (let i = 1; i <= steps; i++) {
    const [x, y] = bezier([start.x, start.y], p1, p2, [tx, ty], i / steps);
    await page.mouse.move(x, y);
    if (i % 4 === 0) await sleep(rnd(8, 28)); // human micro-pauses
  }
}

/** Type one character at a time with human-like inter-keystroke rhythm. */
export async function humanType(locator: Locator, text: string): Promise<void> {
  await locator.click();
  for (const ch of text) {
    await locator.press(ch);
    // Bimodal-ish rhythm: short gaps inside "words", occasional longer pauses.
    await sleep(ch === ' ' ? rnd(120, 260) : rnd(70, 210));
  }
}

/** Scroll using wheel events with irregular deltas and pauses. */
export async function humanScroll(page: Page, totalPx = 900): Promise<void> {
  let remaining = totalPx;
  while (remaining > 0) {
    const delta = Math.min(remaining, rnd(40, 180));
    await page.mouse.wheel(0, delta);
    remaining -= delta;
    await sleep(rnd(60, 240));
  }
}

export async function humanLikeActions(page: Page): Promise<void> {
  await page.waitForTimeout(800);
  await humanMouseMove(page, page.locator('#claim'));
  await page.mouse.down();
  await sleep(rnd(40, 90));
  await page.mouse.up();

  await humanType(page.locator('#phone'), '13800138000');
  await sleep(rnd(200, 500));
  await humanType(page.locator('#code'), '4827');

  await humanMouseMove(page, page.locator('#target'));
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(rnd(0, 60) + (await page.locator('#target').boundingBox())!.x + 30, rnd(0, 30) + (await page.locator('#target').boundingBox())!.y + 20);
    await sleep(rnd(120, 320));
  }

  await humanScroll(page, 1000);
  await humanMouseMove(page, page.locator('#bottom'));
  await page.mouse.click((await page.locator('#bottom').boundingBox())!.x + 10, (await page.locator('#bottom').boundingBox())!.y + 10);
  await page.waitForTimeout(700);
}

/** Stock automation flow: Playwright trusted events, zero human rhythm. */
export async function botActions(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  await page.locator('#claim').click();
  await page.locator('#phone').fill('13800138000');
  await page.locator('#code').fill('4827');
  await page.locator('#submit').click();
  await page.locator('#target').click({ clickCount: 3 });
  await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' as ScrollBehavior }));
  await page.waitForTimeout(200);
  await page.locator('#bottom').click();
  await page.waitForTimeout(500);
}

/**
 * Fully synthetic events from page JS: every event is isTrusted=false.
 * Mimics an attacker that drives the DOM without CDP input injection.
 */
export async function syntheticActions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fire = (el: Element, type: string, opts: Record<string, unknown> = {}): void => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...opts }));
    };
    fire(document.querySelector('#claim')!, 'click');
    const phone = document.querySelector('#phone') as HTMLInputElement;
    phone.value = '13800138000';
    phone.dispatchEvent(new Event('input', { bubbles: true }));
    const code = document.querySelector('#code') as HTMLInputElement;
    code.value = '4827';
    code.dispatchEvent(new Event('input', { bubbles: true }));
    fire(document.querySelector('#submit')!, 'click');
    // Robotically regular mousemove stream on a straight line.
    for (let i = 0; i < 40; i++) {
      fire(document.body, 'mousemove', { clientX: 100 + i * 8, clientY: 200 });
    }
    for (let i = 0; i < 6; i++) fire(document.querySelector('#target')!, 'click', { clientX: 300, clientY: 300 });
    for (let i = 0; i < 8; i++) {
      window.scrollTo(0, (i + 1) * 120);
      document.dispatchEvent(new Event('scroll'));
    }
  });
  await page.waitForTimeout(600);
}

/**
 * Stealth-style environment patching applied BEFORE the SDK loads.
 * Simulates puppeteer-extra-plugin-stealth / undetected-chromedriver style
 * patches — note the webdriver getter becomes non-native, which itself is a
 * signal the contradiction rules look for.
 */
export const STEALTH_INIT_SCRIPT = `
(() => {
  Object.defineProperty(Navigator.prototype, 'webdriver', {
    get: () => false,
    configurable: true,
  });
  window.chrome = { runtime: {}, app: { isInstalled: false }, csi: () => {}, loadTimes: () => {} };
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5].map(i => ({ name: 'Plugin ' + i, filename: 'p' + i })),
    configurable: true,
  });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'], configurable: true });
  const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (originalQuery) {
    window.navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(p);
  }
  // Leak an automation-style global anyway — attackers forget cleanup.
  window.__playwright_stealth__ = { patched: true };
})();
`;

/** Mobile UA spoof on a desktop browser (no touch hardware behind it). */
export const MOBILE_UA_INIT_SCRIPT = `
(() => {
  Object.defineProperty(navigator, 'userAgent', {
    get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    configurable: true,
  });
  Object.defineProperty(navigator, 'platform', { get: () => 'iPhone', configurable: true });
})();
`;

export interface StoredReport {
  sessionId: string;
  score: number;
  verdict: 'bot' | 'suspect' | 'human';
  summary: string[];
  categories: Array<{ category: string; label: string; raw: number; capped: number; cap: number }>;
  dataQuality: Record<string, unknown>;
  evidence: Array<{ id: string; category: string; weight: number; reason: string }>;
}

/** Force the in-page SDK to flush immediately, then return this session's results. */
export async function flushAndGetResults(page: Page): Promise<StoredReport[]> {
  const sessionId = await page.evaluate(() =>
    (window as unknown as { BotGuard: { getSessionId: () => string } }).BotGuard.getSessionId(),
  );
  await page.evaluate(() => (window as unknown as { __bgFlush: () => Promise<void> }).__bgFlush());
  // Two polling rounds: beacon/fetch lands on the server a tick later.
  await page.waitForTimeout(300);
  const res = await fetch(`http://127.0.0.1:8790/api/results/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`session result API failed: ${res.status}`);
  const body = (await res.json()) as { reports: Array<{ result: StoredReport }> };
  return body.reports.map((r) => r.result);
}
