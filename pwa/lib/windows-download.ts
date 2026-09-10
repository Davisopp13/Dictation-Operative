import { AppError } from './domain';
import { windowsRelease } from './windows-release';
import type { Services } from './server';

export async function handleWindowsDownload(request: Request, services: Services, path: string) {
  if (!['GET', 'HEAD'].includes(request.method)) throw new AppError('Download with the button on Windows setup.', 405);
  const release = windowsRelease(path.slice('windows-downloads/'.length));
  if (!release) throw new AppError('Choose the Intel/AMD or ARM Windows download.', 404);
  if (!services.images) throw new AppError('Downloads are temporarily unavailable. Please retry.', 503);
  const stored = await services.images.get(release.key);
  if (!stored) throw new AppError('This download is not available yet. Please retry shortly.', 503);
  if (stored.size !== release.size) {
    await stored.body.cancel();
    throw new AppError('This download needs to be updated. Please retry later.', 503);
  }
  if (request.method === 'HEAD') await stored.body.cancel();
  // Stream the ZIP from R2; never buffer a ~50 MB download inside the Worker.
  return new Response(request.method === 'HEAD' ? null : stored.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${release.filename}"`,
      'Content-Length': String(stored.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'ETag': `"${release.sha256}"`,
    },
  });
}
