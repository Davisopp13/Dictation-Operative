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
    throw new Error(
      'You’re offline or the connection was interrupted. Your unsaved words are still here.',
    );
  }
  let data: { error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      'The workspace could not be reached. Check your connection and sign in again.',
    );
  }
  if (!response.ok)
    throw new Error(data.error ?? 'The request could not be completed.');
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
