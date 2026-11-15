import fs from 'node:fs';
import { score } from '../src/server/score/engine.ts';

const all = JSON.parse(fs.readFileSync('data/results/packets.json', 'utf8'));
const rows: any[] = [];
for (const r of all) {
  if (!r.ok || !r.packet) { console.log('SKIP', r.scenario, r.note || r.error); continue; }
  const res = score({ ...r.packet, env: normalizeEnv(r.packet.env), behavior: r.packet.behavior } as any);
  rows.push({ scenario: r.scenario, ...res });
}

function normalizeEnv(e: any) {
  // adapt the SDK's compact fact names to the engine's expected shape
  return {
    ...e,
    uaBrands: e.uaBrands || [],
    hasUAData: e.hasUAData,
    uaMobile: e.uaMobile,
    pluginNames: e.pluginNames || [],
    pluginsN: e.pluginsN,
    pdfViewerEnabled: e.pdfViewerEnabled,
    chromeKeys: e.chromeKeys,
    notifPermission: e.notifPermission,
    maxTouchPoints: e.maxTouchPoints,
    pointerCoarse: e.pointerCoarse, pointerFine: e.pointerFine,
    hardwareConcurrency: e.hardwareConcurrency,
    glRenderer: e.glRenderer, glVendor: e.glVendor,
    canvasMetrics: e.canvasMetrics,
    navOwnTampered: e.navOwnTampered,
    navNonNative: e.navNonNative,
    suspiciousGlobals: e.suspiciousGlobals,
    iframeWebdriver: e.iframeWebdriver,
    permissionsQueryTampered: e.permissionsQueryTampered,
    funcToStringTampered: e.funcToStringTampered,
    webdriverDesc: e.webdriverDesc,
    screenW: e.screenW, screenH: e.screenH, availW: e.availW, availH: e.availH,
    innerW: e.innerW, innerH: e.innerH, outerW: e.outerW, outerH: e.outerH,
    dpr: e.dpr, languages: e.languages, platform: e.platform,
    connection: e.connection,
  };
}

console.log('\nscenario        score  band        conf    verdict    families');
console.log('-'.repeat(100));
for (const r of rows) {
  const fam = r.families.filter((f: any) => f.points > 0).map((f: any) => `${f.id}:${f.points}`).join(' ');
  console.log(`${r.scenario.padEnd(15)} ${String(r.score).padStart(4)}  ${r.band.padEnd(11)} ${r.confidence.padEnd(7)} ${r.verdict.padEnd(10)} ${fam}`);
}
console.log('\n--- per-scenario signal detail ---');
for (const r of rows) {
  console.log(`\n### ${r.scenario}  (score ${r.score})`);
  for (const h of r.top) console.log(`  [${h.family}] +${String(h.points).padStart(3)} ${h.id} — ${h.evidence}`);
}
fs.writeFileSync('data/results/scores.json', JSON.stringify(rows, null, 1));
