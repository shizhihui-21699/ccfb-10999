/**
 * Repeat-level evaluation: reports the distribution of scores per scenario,
 * not a single lucky run. A detection system whose only evidence is one
 * sample per class cannot be trusted, so every claim in the README is backed
 * by this table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { score } from '../src/server/score/engine.ts';

const DIR = path.resolve(import.meta.dirname, '../data/results');
const groups: { label: string; kind: 'human' | 'bot'; files: string[] }[] = [
  { label: 'human (OS input, no CDP)', kind: 'human', files: pick('repeat/h') },
  { label: 'human-fast (OS input)', kind: 'human', files: pick('repeat/f') },
  { label: 'pw-script', kind: 'bot', files: pick('repeat/pw-script_') },
  { label: 'naive-bot', kind: 'bot', files: pick('repeat/n') },
  { label: 'script-kiddie', kind: 'bot', files: pick('repeat/script-kiddie_') },
  { label: 'pw-stealth', kind: 'bot', files: pick('repeat/pw-stealth_') },
  { label: 'pw-mobile', kind: 'bot', files: pick('repeat/pw-mobile_') },
  { label: 'ua-spoof', kind: 'bot', files: pick('repeat/ua-spoof_') },
];

function pick(prefix: string): string[] {
  if (!fs.existsSync(DIR)) return [];
  const dir = fs.existsSync(path.join(DIR, 'repeat')) ? path.join(DIR, 'repeat') : DIR;
  const base = prefix.includes('/') ? path.join(DIR, path.dirname(prefix)) : DIR;
  const name = path.basename(prefix);
  return fs.readdirSync(base).filter(f => f.startsWith(name) && f.endsWith('.json')).sort().map(f => path.join(base, f));
}

const rows: any[] = [];
for (const g of groups) {
  if (!g.files.length) continue;
  const scores: number[] = [];
  const verdicts: Record<string, number> = {};
  const families: Record<string, number> = {};
  for (const f of g.files) {
    const all = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of all) {
      if (!r.ok || !r.packet) continue;
      const res = score(r.packet);
      scores.push(res.score);
      verdicts[res.verdict] = (verdicts[res.verdict] || 0) + 1;
      for (const fam of res.families) if (fam.points > 0) families[fam.id] = (families[fam.id] || 0) + 1;
    }
  }
  if (!scores.length) continue;
  const n = scores.length;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  rows.push({
    group: g.label, kind: g.kind, n,
    min: Math.min(...scores), max: Math.max(...scores),
    mean: +mean.toFixed(1),
    fp: g.kind === 'human' ? scores.filter(s => s >= 35).length / n : null,
    tp: g.kind === 'bot' ? scores.filter(s => s >= 65).length / n : null,
    verdicts, families,
  });
}

console.log('group                        n   min  max  mean  FP-rate  TP-rate  verdicts');
console.log('-'.repeat(96));
for (const r of rows) {
  const fp = r.fp == null ? '   -   ' : (r.fp * 100).toFixed(1).padStart(6) + '%';
  const tp = r.tp == null ? '   -   ' : (r.tp * 100).toFixed(1).padStart(6) + '%';
  console.log(`${r.group.padEnd(28)} ${String(r.n).padStart(2)}  ${String(r.min).padStart(3)}  ${String(r.max).padStart(3)}  ${String(r.mean).padStart(4)}  ${fp}  ${tp}  ${JSON.stringify(r.verdicts)}`);
}
fs.writeFileSync(path.join(DIR, 'bench.json'), JSON.stringify(rows, null, 1));
