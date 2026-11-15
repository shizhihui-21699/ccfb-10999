import fs from 'node:fs';
import { score } from '../src/server/score/engine.ts';
for (const r of JSON.parse(fs.readFileSync('data/results/packets.json','utf8'))) {
  if (!r.ok) continue;
  const res = score(r.packet);
  const m = r.packet.behavior.mouse;
  console.log(`${r.scenario.padEnd(14)} score=${String(res.score).padStart(3)} verdict=${res.verdict.padEnd(9)} moves=${m.moveCount} straight=${m.straightness?.toFixed(3)} dirRate=${m.dirRate?.toFixed(3)} dtCV=${m.dtCV?.toFixed(2)} segCV=${m.segCV?.toFixed(2)} clicks=${r.packet.behavior.clicks}`);
  for (const h of res.top) console.log('     ', h.id, h.points, '|', h.evidence);
}
