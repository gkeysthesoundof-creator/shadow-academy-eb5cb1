import { asService, pool } from '../src/lib/db';
import { provisionUser } from '../src/lib/auth/core';
import { seedReferenceData } from '../src/lib/seed';

/** Idempotent: reference data + one e2e CUSTOMER account (the founder is created separately). */
export default async function globalSetup() {
  await asService(async (c) => {
    await seedReferenceData(c);
    await provisionUser(c, { email: 'e2e-customer@local.test', password: 'e2e-customer-password', displayName: 'E2E Customer', role: 'customer', plan: 'free' });
  });
  await pool().end();
}
