import { AppError } from './domain';
import { MAC_RELEASE_KEY, macRelease } from './mac-release';
import type { Services } from './server';

export async function handleMacDownload(request: Request, services: Services, path: string) {
  if (!['GET', 'HEAD'].includes(request.method))
    throw new AppError('Download with the button on Mac setup.', 405);
  if (path !== 'mac-downloads/arm64')
    throw new AppError('Choose the Apple Silicon download on Mac setup.', 404);
  if (!services.images)
    throw new AppError('Downloads are temporarily unavailable. Please retry.', 503);
  const stored = await services.images.get(MAC_RELEASE_KEY);
  if (!stored)
    throw new AppError('This download is not available yet. Please retry shortly.', 503);
  if (stored.size !== macRelease.size) {
    await stored.body.cancel();
    throw new AppError('This download needs to be updated. Please retry later.', 503);
  }
  if (request.method === 'HEAD') await stored.body.cancel();
  // Use the bucket stream directly; the installer never enters the asset bundle.
  return new Response(request.method === 'HEAD' ? null : stored.body, {
    headers: {
      'Content-Type': 'application/x-apple-diskimage',
      'Content-Disposition': `attachment; filename="${macRelease.filename}"`,
      'Content-Length': String(stored.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'ETag': `"${macRelease.sha256}"`,
    },
  });
}
