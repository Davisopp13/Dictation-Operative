import { env } from 'cloudflare:workers';
import { handleWorkspaceRequest } from '@/lib/workspace-request';
export const dynamic = 'force-dynamic';
const handle = (request: Request) => handleWorkspaceRequest(request, env);
export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

export const PUT = POST;
