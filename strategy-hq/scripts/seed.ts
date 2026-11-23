/* Seeds reference data (scouts, flags, plans, sources, rights, official seed items). Idempotent. */
import { asService, pool } from '../src/lib/db';
import { seedReferenceData } from '../src/lib/seed';

asService((c) => seedReferenceData(c))
  .then(() => { console.log('reference data seeded'); return pool().end(); })
  .catch((e) => { console.error(e); process.exit(1); });
