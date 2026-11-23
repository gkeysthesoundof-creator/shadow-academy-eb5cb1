/** Exact words only. "delivered" appears only when the stored status is literally 'delivered'. */
export function deliveryWords(status: string | null, error: string | null): { label: string; cls: string } {
  switch (status) {
    case null: case undefined: return { label: 'no delivery attempt recorded', cls: 'muted' };
    case 'dry_run': return { label: 'dry run', cls: 'muted' };
    case 'blocked': return { label: `blocked${error ? ` (${error})` : ''}`, cls: 'gold' };
    case 'provider_accepted': return { label: 'provider accepted (not proof of inbox delivery)', cls: 'cyan' };
    case 'failed': return { label: `failed${error ? ` (${error})` : ''}`, cls: 'red' };
    case 'delivered': return { label: 'delivered', cls: 'green' };
    default: return { label: String(status).replace(/_/g, ' '), cls: 'muted' };
  }
}
