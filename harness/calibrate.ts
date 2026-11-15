/**
 * Produces data/calibration.json: the measured values that set each
 * threshold. Thresholds in the engine should be traceable to this file, so a
 * later reader can see whether a rule was tuned on evidence or guessed.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../data/results');
const read = (f: string) => {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; }
};

// Gather every captured packet across the repeat set.
const repeatDir = path.join(DIR, 'repeat');
const packets: any[] = [];
if (fs.existsSync(repeatDir)) {
  for (const f of fs.readdirSync(repeatDir)) {
    if (!f.endsWith('.json')) continue;
    const rows = JSON.parse(fs.readFileSync(path.join(repeatDir, f), 'utf8'));
    for (const r of rows) if (r.ok && r.packet) packets.push({ scenario: r.scenario, kind: r.kind, ...r.packet });
  }
}

const pick = (pred: (p: any) => boolean) => packets.filter(pred);
const stat = (xs: number[]) => {
  const v = xs.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, min: +v[0].toFixed(4), p10: +q(0.1).toFixed(4), median: +q(0.5).toFixed(4), p90: +q(0.9).toFixed(4), max: +v[v.length - 1].toFixed(4) };
};

const humans = pick(p => p.kind === 'human');
const humansWithClicks = humans.filter(p => p.behavior?.clicks > 0);
const automated = pick(p => p.kind === 'automated');

const calib = {
  generatedFromPackets: packets.length,
  humanSessions: humans.length,
  automatedSessions: automated.length,
  measurements: {
    humanStraightness: stat(humans.map(p => p.behavior.mouse.straightness)),
    humanSegCV: stat(humans.map(p => p.behavior.mouse.segCV)),
    humanDirRate: stat(humans.map(p => p.behavior.mouse.dirRate)),
    humanClickDwellMs: stat(humans.map(p => p.behavior.mouse.clickDwellMean)),
    humanKeyGapMedianMs: stat(humans.map(p => p.behavior.keyboard.gap.median)),
    humanKeyGapCV: stat(humans.map(p => p.behavior.keyboard.gap.cv)),
    humanKeyDwellCV: stat(humans.map(p => p.behavior.keyboard.dwell.cv)),
    humanFirstClickMs: stat(humansWithClicks.map(p => p.behavior.firstClickMs)),
    humanTeleportations: stat(humans.map(p => p.behavior.mouse.teleportations ?? 0)),
    automatedStraightness: stat(automated.map(p => p.behavior.mouse.straightness)),
    automatedSegCV: stat(automated.map(p => p.behavior.mouse.segCV)),
    automatedKeyGapMedianMs: stat(automated.map(p => p.behavior.keyboard.gap.median)),
    automatedTeleportations: stat(automated.map(p => p.behavior.mouse.teleportations ?? 0)),
  },
  thresholdsRationale: {
    'mouse.perfect-straight': '触发阈值 0.999；真人实测 straightness 上界见 humanStraightness.max，两者无重叠',
    'mouse.equal-segments': '触发阈值 segCV < 0.02；真人下界见 humanSegCV.min',
    'mouse.metronome': '触发阈值 dtCV < 0.05；真人 dtCV 远高于此',
    'mouse.press-too-short': '触发阈值 < 25ms；真人点击按下时长中位见 humanClickDwellMs.median',
    'kb.metronome': '触发阈值 gap CV < 0.15；真人下界见 humanKeyGapCV.min',
    'kb.dwell-constant': '触发阈值 CV < 0.06 且 n>=8；早期 0.1/n>=5 曾在真人样本上误报，故收紧',
    'mouse.teleport': '触发阈值单步 >=60px 且速度 >=20000px/s；真人样本 teleportations 恒为 0',
    'touch.contact-too-short': '触发阈值 < 35ms；合成触摸实测 0.1–14ms',
  },
};

fs.writeFileSync(path.join(DIR, '..', 'calibration.json'), JSON.stringify(calib, null, 2));
console.log(JSON.stringify(calib.measurements, null, 1));
