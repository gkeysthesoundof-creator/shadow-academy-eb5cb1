/* Creates (or updates) the founder/owner account. Registration is otherwise closed.
   Usage: FOUNDER_EMAIL=you@example.com FOUNDER_PASSWORD='12+ chars' npm run founder:create
   The password is hashed with scrypt; it is never stored or printed in plain text. */
import { asService, pool } from '../src/lib/db';
import { provisionUser } from '../src/lib/auth/core';

const email = process.env.FOUNDER_EMAIL;
const password = process.env.FOUNDER_PASSWORD;
if (!email || !password) {
  console.error('Set FOUNDER_EMAIL and FOUNDER_PASSWORD (12+ characters).');
  process.exit(1);
}
asService((c) => provisionUser(c, { email, password, displayName: process.env.FOUNDER_NAME ?? 'Founder', role: 'owner', plan: 'founder' }))
  .then((id) => { console.log(`founder account ready (${id})`); return pool().end(); })
  .catch((e) => { console.error(e.message); process.exit(1); });
