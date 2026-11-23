import { NextResponse, type NextRequest } from 'next/server';

/**
 * Passes the requested path to server components (so the login redirect can
 * preserve deep links from emails). Real auth checks happen server-side against
 * the database session; this proxy never decides access by itself.
 */
export function proxy(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set('x-gsq-path', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  matcher: ['/((?!_next/|api/|icons/|manifest.webmanifest|sw.js|favicon.ico|robots.txt).*)'],
};
