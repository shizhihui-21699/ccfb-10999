#!/usr/bin/env node
/**
 * CLI scorer: pipe or pass a report JSON file, get the full explainable result.
 *   node server/src/cli.ts path/to/report.json
 *   cat report.json | node server/src/cli.ts
 */
import { readFile } from 'node:fs/promises';
import type { BotGuardReport } from '../../shared/protocol.ts';
import { scoreReport } from './scorer.ts';

async function main(): Promise<void> {
  let raw: string;
  const file = process.argv[2];
  if (file) {
    raw = await readFile(file, 'utf8');
  } else {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    raw = Buffer.concat(chunks).toString('utf8');
  }
  const report = JSON.parse(raw) as BotGuardReport;
  const result = scoreReport(report);

  console.log(`\n会话 ${result.sessionId}`);
  console.log(`总分 ${result.score}  判定: ${result.verdict.toUpperCase()}  (阈值 suspect≥${result.threshold.suspect}, bot≥${result.threshold.bot})`);
  console.log('─'.repeat(72));
  for (const cat of result.categories) {
    console.log(`\n[${cat.label}] 贡献 ${cat.capped}/${cat.cap}  (规则原始合计 ${cat.raw})`);
    if (!cat.evidence.length) console.log('  （无命中规则）');
    for (const e of cat.evidence) {
      const sign = e.weight >= 0 ? `+${e.weight}` : `${e.weight}`;
      console.log(`  ${e.severity.toUpperCase().padEnd(6)} ${sign.padStart(4)} ${e.id}`);
      console.log(`         ${e.reason}`);
      console.log(`         observed: ${JSON.stringify(e.observed)}`);
      if (e.expected) console.log(`         expected: ${e.expected}`);
    }
  }
  console.log('\n数据质量:', JSON.stringify(result.dataQuality));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
