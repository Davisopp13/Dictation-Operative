import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { resolveUser, logoutPath } from '@/lib/identity';
export type { User } from '@/lib/identity';

export async function getUser() {
  return resolveUser(env, await headers());
}

/// Public account entry with a same-origin return destination.
export function signInPath(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function signOutPath(): string {
  return logoutPath(env);
}

export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  let url: URL;
  try {
    url = new URL(value, 'https://app.local');
  } catch {
    return '/';
  }
  if (url.origin !== 'https://app.local') return '/';
  if (url.pathname.startsWith('/cdn-cgi/')) return '/';

  return `${url.pathname}${url.search}${url.hash}`;
}
