/**
 * Behavioural test drivers.
 *
 * Two kinds of arms are exercised:
 *
 *   Automated  - Playwright / raw DOM scripting. A detection that fires here
 *                is a true positive.
 *   Human      - A real Chrome process launched *without* a debugging port,
 *                driven by OS-level CGEvents. No CDP is attached, so the
 *                browser reports webdriver=false and the full normal plugin
 *                stack: this is the arm that decides whether a signal is a
 *                false positive.
 *
 * The distinction matters: attaching CDP at all flips navigator.webdriver,
 * so an automation-driven browser can never serve as the human baseline.
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const DIR = path.resolve(import.meta.dirname);
const REPO = path.resolve(DIR, '..');
const OUT = path.join(REPO, 'data/results');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface Captured { [sid: string]: any }
const captured: Captured = {};
let lastGeom: any = null;

async function harnessServer() {
  const sdkPath = path.join(REPO, 'dist/botshield.min.js');
  const pageHtml = fs.readFileSync(path.join(DIR, 'page.html'), 'utf8');
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname === '/sdk.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(sdkPath));
      return;
    }
    if (url.pathname === '/api/geom' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try { lastGeom = JSON.parse(body); } catch { /* ignore */ }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
      });
      return;
    }
    if (url.pathname === '/api/collect' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try {
          const pkt = JSON.parse(body);
          captured[pkt.sid] = pkt;
          (globalThis as any).__lastPacket = pkt;
        } catch { /* ignore */ }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(pageHtml);
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;
  return { srv, url: `http://127.0.0.1:${port}/` };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Force a finalize + send from inside the page (CDP arms only). */
async function grab(page: any): Promise<any> {
  await page.evaluate(() => new Promise<void>(res => {
    const w: any = window;
    w.bs.envReady(() => { w.bs.send().then(() => res()); setTimeout(() => res(), 300); });
  }));
  await sleep(300);
  return await page.evaluate(() => (window as any).__lastPacket ?? null) ??
    (globalThis as any).__lastPacket ?? null;
}

// ----------------------------------------------------- synthetic trajectories

function straightPath(from: any, to: any, steps: number, dt: number) {
  const out: any[] = [];
  for (let i = 1; i <= steps; i++) out.push({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, dt });
  return out;
}

function curvedPath(from: any, to: any, steps: number, seed = 7) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out: any[] = [];
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const arc = Math.sin(u * Math.PI) * 40;
    out.push({
      x: from.x + (to.x - from.x) * u + arc * 0.6 + (rand() - 0.5) * 3,
      y: from.y + (to.y - from.y) * u - arc * 0.4 + (rand() - 0.5) * 3,
      dt: 8 + rand() * 18,
    });
  }
  return out;
}

// ---------------------------------------------------- human timing model
//
// Synthetic OS input has machine-precision timing: uniform jitter produces a
// CV around 0.15, while measured human typing sits near 0.4-0.6 because of
// finger choice, bursts, and pauses. To avoid calibrating against a baseline
// that is not human, the human arms draw from a documented model:
//   inter-key gap ~ lognormal(median 180ms, sigma 0.55), with a 6% chance of
//   a word-boundary pause (x2.5), and dwell ~ normal(85ms, 18ms).
// This is still synthetic; real-human recording remains the final check.

function lognormal(median: number, sigma: number): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * z);
}

function gauss(): number {
  const u1 = Math.random() || 1e-9, u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function humanRhythm(n: number, speed = 1): { down: number; gap: number }[] {
  const out: { down: number; gap: number }[] = [];
  for (let i = 0; i < n; i++) {
    let gap = lognormal(180, 0.55) / speed;
    if (Math.random() < 0.06) gap *= 2.5;
    // Dwell varies more than a naive uniform model suggests: finger pressure
    // and same-finger repeats produce spread, and held keys are common.
    const down = Math.random() < 0.08 ? 150 + Math.random() * 90 : Math.max(40, 90 + gauss() * 26);
    out.push({ down: Math.round(down), gap: Math.round(gap) });
  }
  return out;
}

// -------------------------------------------------------------- scenarios

interface Result { scenario: string; kind: 'automated' | 'human'; ok: boolean; packet?: any; error?: string; note?: string }

const done = (scenario: string, kind: Result['kind'], pkt: any): Result =>
  ({ scenario, kind, ok: !!pkt, packet: pkt || undefined });

/** 1. Naive DOM bot: element.click(), no pointer path at all. */
async function naiveBot(url: string): Promise<Result> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(() => {
      const input = document.getElementById('phone') as HTMLInputElement;
      input.value = '13800000000';
      document.getElementById('coupon')!.click();
    });
    await sleep(250);
    return done('naive-bot', 'automated', await grab(page));
  } catch (e: any) { return { scenario: 'naive-bot', kind: 'automated', ok: false, error: String(e?.message ?? e) }; }
  finally { await browser.close(); }
}

/** 2. "Humanizer" bot: setInterval interpolation at a fixed 16ms cadence. */
async function scriptKiddie(url: string): Promise<Result> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(() => new Promise<void>(res => {
      const target = document.getElementById('coupon')!;
      const r = target.getBoundingClientRect();
      const end = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      let i = 0;
      const N = 40;
      const timer = setInterval(() => {
        i++;
        const x = 80 + (end.x - 80) * i / N;
        const y = 120 + (end.y - 120) * i / N;
        dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }));
        dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
        if (i >= N) { clearInterval(timer); target.click(); res(); }
      }, 16);
    }));
    await sleep(300);
    return done('script-kiddie', 'automated', await grab(page));
  } catch (e: any) { return { scenario: 'script-kiddie', kind: 'automated', ok: false, error: String(e?.message ?? e) }; }
  finally { await browser.close(); }
}

/** 3. Playwright's own APIs: mouse.move(steps), click, keyboard.type. */
async function pwScript(url: string): Promise<Result> {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    await page.mouse.move(100, 100);
    await page.mouse.move(400, 300, { steps: 12 });
    await page.click('#coupon');
    await page.fill('#phone', '13800000000');
    await page.keyboard.type('abc123', { delay: 40 });
    await sleep(250);
    return done('pw-script', 'automated', await grab(page));
  } catch (e: any) { return { scenario: 'pw-script', kind: 'automated', ok: false, error: String(e?.message ?? e) }; }
  finally { await browser.close(); }
}

/** 4. Playwright + scripted fingerprint mask: UA swap, webdriver deleted. */
async function pwStealth(url: string): Promise<Result> {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [{ name: 'PDF Viewer' }, { name: 'Chrome PDF Viewer' }] });
      Object.defineProperty(navigator, 'mimeTypes', { get: () => [{ type: 'application/pdf' }] });
      // @ts-ignore
      window.chrome = { app: { isInstalled: false }, runtime: {}, csi: () => {}, loadTimes: () => {} };
    });
    await page.goto(url);
    await page.tap('#coupon');
    await sleep(250);
    return done('pw-stealth', 'automated', await grab(page));
  } catch (e: any) { return { scenario: 'pw-stealth', kind: 'automated', ok: false, error: String(e?.message ?? e) }; }
  finally { await browser.close(); }
}

/** 5. Playwright mobile emulation with a hand-written Android UA. */
async function pwMobile(url: string): Promise<Result> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Mobile Safari/537.36',
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(url);
    const box = await page.locator('#coupon').boundingBox();
    if (box) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 10, y: box.y + 10 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await sleep(250);
    return done('pw-mobile', 'automated', await grab(page));
  } catch (e: any) { return { scenario: 'pw-mobile', kind: 'automated', ok: false, error: String(e?.message ?? e) }; }
  finally { await browser.close(); }
}

/** 6. UA-only spoof: real headful Chrome, only the UA string is changed. */
async function uaSpoof(url: string): Promise<Result> {
  const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--window-position=0,0', '--window-size=1000,760'] });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
      viewport: null,
    });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.mouse.move(200, 200);
    await page.mouse.move(420, 330, { steps: 14 });
    await page.mouse.click(420, 330);
    await sleep(250);
    return done('ua-spoof', 'automated', await grab(page));
  } catch (e: any) { return { scenario: 'ua-spoof', kind: 'automated', ok: false, error: String(e?.message ?? e) }; }
  finally { await browser.close(); }
}

/**
 * 7. HUMAN baseline: real Chrome, no debugging port, OS-level input only.
 * The page reports its own geometry over HTTP; the driver aims CGEvents at
 * those coordinates and the SDK's click handler submits the packet.
 */
async function humanBaseline(url: string, variant: 'human' | 'human-fast' = 'human'): Promise<Result> {
  const name = variant;
  if (process.platform !== 'darwin' || !fs.existsSync(CHROME)) {
    return { scenario: name, kind: 'human', ok: false, note: 'skipped: macOS Chrome missing' };
  }
  try {
    if (execFileSync(path.join(DIR, 'native/permcheck')).toString().trim() !== 'true') {
      return { scenario: name, kind: 'human', ok: false, note: 'skipped: no accessibility permission' };
    }
  } catch { return { scenario: name, kind: 'human', ok: false, note: 'skipped: permcheck missing' }; }

  const profile = `/tmp/bd_human_${Date.now()}`;
  lastGeom = null;
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-session-crashed-bubble', '--window-position=40,60', '--window-size=1000,780',
    url,
  ], { stdio: 'ignore', detached: false });
  const before = new Set(Object.keys(captured));
  try {
    // Wait for the page to report geometry (means SDK is live).
    for (let i = 0; i < 100 && !lastGeom; i++) await sleep(100);
    if (!lastGeom) throw new Error('page never reported geometry');
    // Activate this exact Chrome instance.
    execFileSync(path.join(DIR, 'native/act'), [String(proc.pid)]);
    await sleep(1000);

    const g = lastGeom;
    const baseX = g.sx, baseY = g.sy + g.chromeTop;
    const fast = variant === 'human-fast';

    // Approach the coupon with a natural curve, hesitate, then click.
    const plan: any = { moves: [], clicks: [], keys: [] };
    let prev = { x: 130 + Math.random() * 60, y: 110 + Math.random() * 40 };
    const segs = [
      { to: { x: g.coupon.x - 40, y: g.coupon.y - 30 }, n: 26 },
      { to: { x: g.coupon.x - 6, y: g.coupon.y - 3 }, n: 9 },
      { to: g.coupon, n: 3 },
    ];
    for (const seg of segs) {
      for (const pt of curvedPath(prev, seg.to, seg.n, Math.floor(Math.random() * 1000))) {
        plan.moves.push([Math.round(baseX + pt.x), Math.round(baseY + pt.y), Math.round(fast ? pt.dt * 0.7 : pt.dt)]);
      }
      prev = seg.to;
    }
    plan.clicks.push({ x: Math.round(baseX + g.coupon.x), y: Math.round(baseY + g.coupon.y), dwell: fast ? 62 : 96 + Math.round(Math.random() * 30) });
    fs.writeFileSync('/tmp/bd_human_plan.json', JSON.stringify(plan));
    execFileSync(path.join(DIR, 'native/human_input'), ['/tmp/bd_human_plan.json']);
    await sleep(350);

    // Focus the phone field and type with a human rhythm.
    const plan2: any = { moves: [], clicks: [], keys: [] };
    for (const pt of curvedPath(g.coupon, g.phone, 14, Math.floor(Math.random() * 1000))) {
      plan2.moves.push([Math.round(baseX + pt.x), Math.round(baseY + pt.y), Math.round(fast ? pt.dt * 0.7 : pt.dt)]);
    }
    plan2.clicks.push({ x: Math.round(baseX + g.phone.x), y: Math.round(baseY + g.phone.y), dwell: 74 });
    // Draw keystrokes from the documented human timing model. A fixed array
    // or uniform jitter would itself look metronomic and invalidate the arm.
    for (const k of humanRhythm(12, fast ? 1.6 : 1)) plan2.keys.push({ code: 0, down: k.down, gap: k.gap });
    fs.writeFileSync('/tmp/bd_human_plan2.json', JSON.stringify(plan2));
    execFileSync(path.join(DIR, 'native/human_input'), ['/tmp/bd_human_plan2.json']);
    await sleep(300);

    // Click the coupon again to submit. The first click already sent a packet;
    // sending a second time after typing is what a real user's flow produces.
    const pkt0 = firstNew(before);
    const plan3: any = { moves: [], clicks: [], keys: [] };
    for (const pt of curvedPath(g.phone, g.coupon, 18, Math.floor(Math.random() * 1000))) {
      plan3.moves.push([Math.round(baseX + pt.x), Math.round(baseY + pt.y), Math.round(pt.dt)]);
    }
    plan3.clicks.push({ x: Math.round(baseX + g.coupon.x), y: Math.round(baseY + g.coupon.y), dwell: 88 });
    fs.writeFileSync('/tmp/bd_human_plan3.json', JSON.stringify(plan3));
    execFileSync(path.join(DIR, 'native/human_input'), ['/tmp/bd_human_plan3.json']);
    await sleep(900);

    const pkt = firstNew(before) ?? pkt0;
    return done(name, 'human', pkt);
  } catch (e: any) {
    return { scenario: name, kind: 'human', ok: false, error: String(e?.message ?? e) };
  } finally {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    await sleep(250);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function firstNew(before: Set<string>) {
  for (const k of Object.keys(captured)) if (!before.has(k)) return captured[k];
  return null;
}

// --------------------------------------------------------------------- main

const SCENARIOS: Record<string, (u: string) => Promise<Result>> = {
  'naive-bot': naiveBot,
  'script-kiddie': scriptKiddie,
  'pw-script': pwScript,
  'pw-stealth': pwStealth,
  'pw-mobile': pwMobile,
  'ua-spoof': uaSpoof,
  'human': (u) => humanBaseline(u, 'human'),
  'human-fast': (u) => humanBaseline(u, 'human-fast'),
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(SCENARIOS);
const outFile = process.env.BD_OUT || 'packets.json';
const { srv, url } = await harnessServer();
fs.mkdirSync(OUT, { recursive: true });
const all: Result[] = [];
for (const name of names) {
  process.stdout.write(`running ${name} ... `);
  try {
    const r = await SCENARIOS[name](url);
    all.push(r);
    console.log(r.ok ? `ok (sid ${String(r.packet?.sid).slice(0, 8)})` : 'FAILED ' + (r.note || r.error || 'no packet'));
  } catch (e: any) {
    all.push({ scenario: name, kind: 'automated', ok: false, error: String(e?.message ?? e) });
    console.log('THREW ' + (e?.message ?? e));
  }
}
fs.writeFileSync(path.join(OUT, outFile), JSON.stringify(all, null, 1));
srv.close();
console.log(`\nwrote ${all.length} packet(s) to data/results/${outFile}`);
