import { AppError } from './domain';
export async function readBounded(request: Request, max: number) {
  if (Number(request.headers.get('content-length')) > max)
    throw new AppError('This request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError('This request is too large.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
