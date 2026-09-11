import { env } from 'cloudflare:workers';
import { authReady, createAppAuth } from '@/lib/app-auth';
import { readBounded } from '@/lib/request';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  if (!authReady(env)) return Response.json({ message: 'Sign-in is being configured. Please try again later.' }, { status: 503 });
  try {
    // Bound auth JSON before the library reads it. OAuth callbacks have no body.
    if (request.method === 'POST') {
      const bytes = await readBounded(request, 16384);
      request = new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
    }
    const response = await createAppAuth(env).handler(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return Response.json({ message: 'Sign-in could not be completed. Please retry.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
export const GET = handle;
export const POST = handle;
