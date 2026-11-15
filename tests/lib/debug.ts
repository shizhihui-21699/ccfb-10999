import { chromium } from 'playwright';
import { createApp } from '../../server/src/index.ts';

const server = createApp().listen(8791, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => console.log(`[console.${msg.type()}]`, msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText));

await page.goto('http://127.0.0.1:8791/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const sdkState = await page.evaluate(() => ({
  hasSDK: typeof window.BotGuardSDK,
  hasGuard: typeof window.BotGuard,
}));
console.log('SDK state:', JSON.stringify(sdkState));

await page.evaluate(() => window.BotGuard!.flush(false));
await page.waitForTimeout(1000);

const res = await fetch('http://127.0.0.1:8791/api/results').then((r) => r.json());
console.log('server sessions:', res.count);

await browser.close();
server.close();
