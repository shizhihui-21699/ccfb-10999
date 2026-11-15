import { chromium } from 'playwright';
import { createApp } from '../../server/src/index.ts';

const server = createApp().listen(8792, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8792/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// stock automation flow
await page.locator('#claim').click();
await page.locator('#phone').fill('13800138000');
await page.locator('#code').fill('4827');
await page.locator('#submit').click();
await page.locator('#target').click({ clickCount: 3 });
await page.evaluate(() => window.scrollTo({ top: 1000 }));
await page.locator('#bottom').click();
await page.waitForTimeout(800);

const sessionId = await page.evaluate(() => window.BotGuard!.getSessionId());
await page.evaluate(() => window.__bgFlush());
await page.waitForTimeout(500);

const res = await fetch(`http://127.0.0.1:8792/api/results/${sessionId}`).then((r) => r.json());
const last = res.reports.at(-1).result;
console.log(JSON.stringify(last, null, 2));

await browser.close();
server.close();
