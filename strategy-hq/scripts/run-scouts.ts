/* Manually run the shared scout pipeline and (optionally) the brief stage.
   Usage: npm run scouts:run -- [--brief] [--dry-run]
   Email is never sent from this script unless every delivery gate is satisfied; --dry-run forces dry run. */
import { pool } from '../src/lib/db';
import { runScoutPipeline } from '../src/lib/workers/pipeline';
import { runBriefStage } from '../src/lib/workers/briefing';
import { localParts } from '../src/lib/domain/schedule';
import { config } from '../src/lib/config';

(async () => {
  const now = new Date();
  const { date } = localParts(now, config.timezone);
  const r = await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: `manual:cli:${now.toISOString()}` });
  console.log(`pipeline: ${r.status}`);
  for (const s of r.sources) console.log(`  source ${s.outcome.padEnd(14)} ${s.name} — ${s.note}`);
  for (const [k, v] of Object.entries(r.scouts)) console.log(`  scout  ${v.status.padEnd(14)} ${k} examined=${v.examined} added=${v.added} updated=${v.updated} corrected=${v.corrected}`);
  if (process.argv.includes('--brief')) {
    const out = await runBriefStage(date, { jobId: r.jobId });
    console.log('briefs:', JSON.stringify(out));
  }
  await pool().end();
})().catch((e) => { console.error(e); process.exit(1); });
