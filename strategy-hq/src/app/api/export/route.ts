import { currentUser } from '@/lib/auth/session';
import { buildExport, exportToCsv } from '@/lib/repo/progress';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const data = await buildExport(user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  const csv = new URL(req.url).searchParams.get('format') === 'csv';
  const body = csv ? exportToCsv(data) : JSON.stringify(data, null, 2);
  return new Response(body, {
    headers: {
      'content-type': csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="strategy-hq-export-${stamp}.${csv ? 'csv' : 'json'}"`,
      'cache-control': 'no-store',
    },
  });
}
