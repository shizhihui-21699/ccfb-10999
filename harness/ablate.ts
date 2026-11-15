/**
 * Ablation study.
 *
 * A detector that only works because one trivially-spoofable signal (the UA
 * string) is present is not robust. This script re-scores every captured
 * packet with specific evidence channels removed, to measure how much of the
 * verdict each family actually carries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { score } from '../src/server/score/engine.ts';

const DIR = path.resolve(import.meta.dirname, '../data/results');
const all = JSON.parse(fs.readFileSync(path.join(DIR, 'packets.json'), 'utf8'));

type Ablation = { name: string; mutate: (p: any) => any };

const ABLATIONS: Ablation[] = [
  { name: 'none (as captured)', mutate: p => p },
  {
    name: 'hide UA+client hints (clean Chrome profile strings)',
    mutate: p => {
      const e = p.env;
      e.ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
      e.uaBrands = ['Not-A.Brand/99', 'Google Chrome/157', 'Chromium/157'];
      e.uaMobile = false; e.uaPlatform = 'macOS';
      return p;
    },
  },
  {
    name: 'hide UA + fix plugin/chrome stack + real GL',
    mutate: p => {
      const e = p.env;
      e.ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
      e.uaBrands = ['Not-A.Brand/99', 'Google Chrome/157', 'Chromium/157'];
      e.uaMobile = false; e.platform = 'MacIntel';
      e.pluginsN = 5; e.mimeN = 2; e.pdfViewerEnabled = true;
      e.chromeKeys = ['loadTimes', 'csi', 'app'];
      e.notifPermission = 'default';
      e.pluginNames = ['PDF Viewer', 'Chrome PDF Viewer'];
      e.glRenderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)';
      e.glVendor = 'Google Inc. (Apple)';
      e.screenW = 2560; e.screenH = 1440; e.availableW = 2560; e.availH = 1380;
      e.outerW = 1000; e.outerH = 780; e.innerW = 1000; e.innerH = 693;
      e.screenX = 40; e.screenY = 60; e.dpr = 2;
      e.canvasMetrics = { serif: 138.62, sans: 148.42, mono: 125.23, emoji: 20, cjk: 64 };
      e.webdriver = false;
      delete e.navOwnTampered; delete e.navNonNative; delete e.suspiciousGlobals;
      e.iframeWebdriver = false; e.permissionsQueryTampered = false; e.funcToStringTampered = false;
      return p;
    },
  },
  {
    name: 'hide UA + full env cleanup (behaviour + integrity only)',
    mutate: p => {
      const e = p.env;
      e.ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
      e.uaBrands = ['Not-A.Brand/99', 'Google Chrome/157', 'Chromium/157'];
      e.uaMobile = false; e.platform = 'MacIntel'; e.hasUAData = true;
      e.pluginsN = 5; e.mimeN = 2; e.pdfViewerEnabled = true;
      e.chromeKeys = ['loadTimes', 'csi', 'app'];
      e.notifPermission = 'default';
      e.glRenderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)';
      e.screenW = 2560; e.screenH = 1440; e.availW = 2560; e.availH = 1380;
      e.outerW = 1000; e.outerH = 780; e.innerW = 1000; e.innerH = 693;
      e.screenX = 40; e.screenY = 60; e.dpr = 2; e.maxTouchPoints = 0;
      e.canvasMetrics = { serif: 138.62, sans: 148.42, mono: 125.23, emoji: 20, cjk: 64 };
      e.webdriver = false; e.webdriverDesc = 'proto:getter';
      e.navOwnTampered = []; e.navNonNative = []; e.suspiciousGlobals = [];
      e.iframeWebdriver = false; e.permissionsQueryTampered = false; e.funcToStringTampered = false;
      return p;
    },
  },
];

const bots = all.filter((r: any) => r.ok && r.packet && r.kind === 'automated');
const humans = all.filter((r: any) => r.ok && r.packet && r.kind === 'human');

console.log('Ablation: score after removing environment evidence');
console.log('='.repeat(92));
for (const ab of ABLATIONS) {
  console.log(`\n### ${ab.name}`);
  console.log('  scenario           score  band        verdict     families');
  for (const r of [...bots, ...humans]) {
    const res = score(ab.mutate(JSON.parse(JSON.stringify(r.packet))));
    const fam = res.families.filter(f => f.points > 0).map(f => `${f.id}:${f.points}`).join(' ');
    console.log(`  ${r.scenario.padEnd(18)} ${String(res.score).padStart(4)}  ${res.band.padEnd(11)} ${res.verdict.padEnd(11)} ${fam || '-'}`);
  }
}
