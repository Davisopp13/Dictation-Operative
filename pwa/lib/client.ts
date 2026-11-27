export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has('Content-Type')
  )
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch('/api/' + path, {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new Error('You’re offline or the connection was interrupted.');
  }
  let data: { error?: string; code?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      'The workspace could not be reached. Check your connection and sign in again.',
    );
  }
  if (!response.ok)
    throw new APIError(
      data.error ?? 'The request could not be completed.',
      response.status,
      data.code,
    );
  return data as T;
}
export const post = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please retry.';
}
export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
/** The workspace revision; it moves whenever saved items change anywhere. */
export const workspaceRevision = (signal: AbortSignal) =>
  api<{ revision: number }>('v1/revision', { signal }).then((r) => r.revision);
