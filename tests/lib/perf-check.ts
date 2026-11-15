import { chromium } from 'playwright';
import { createApp } from '../../server/src/index.ts';

const server = createApp().listen(8795, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8795/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// Measure long tasks while flooding 5000 mousemove + 1000 key events.
const metrics = await page.evaluate(async () => {
  const longTasks: number[] = [];
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push(e.duration);
  });
  po.observe({ entryTypes: ['longtask'] });
  const t0 = performance.now();
  for (let i = 0; i < 5000; i++) {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: i % 800, clientY: 200 + (i % 100), bubbles: true }));
  }
  for (let i = 0; i < 1000; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));
  }
  const dispatchMs = performance.now() - t0;
  // force aggregation (the expensive path) inside an idle callback
  await new Promise((r) => (window as any).requestIdleCallback ? requestIdleCallback(() => r(null)) : setTimeout(r, 50));
  await (window as any).BotGuard.flush(false);
  await new Promise((r) => setTimeout(r, 300));
  return { dispatchMs, longTasks: longTasks.length, maxLongTask: Math.max(0, ...longTasks) };
});
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
server.close();
