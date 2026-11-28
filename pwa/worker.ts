import { withEnv } from 'cloudflare:workers';
import { releaseEnvironment } from './lib/release-fence';
import { runContentCleanup } from './lib/content';
import app from 'vinext/server/fetch-handler';
import { runClipboardCleanup } from './lib/clipboard-cleanup';
import { handleWorkspaceRequest } from './lib/workspace-request';
import { mainAddressRedirect } from './lib/canonical-origin';

const handler = {
  async scheduled(controller, env) {
    const results = await Promise.allSettled([
      runClipboardCleanup(env.DB, env.IMAGES, controller.scheduledTime),
      runContentCleanup(env.DB, env.IMAGES, controller.scheduledTime),
    ]);
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('Workspace storage cleanup has pending work.');
  },
  async fetch(request, env, ctx) {
    const moved = mainAddressRedirect(request, env);
    if (moved) return moved;
    const path = new URL(request.url).pathname;
    // Workspace APIs do not render React or use framework after() callbacks.
    // Returning their R2 bodies directly preserves native streaming instead of
    // running each download chunk through the framework's JS TransformStream.
    if (
      path.startsWith('/api/') &&
      path !== '/api/auth' &&
      !path.startsWith('/api/auth/')
    ) {
      try {
        return await handleWorkspaceRequest(request, env);
      } catch {
        console.error('DO workspace request failed');
        return Response.json(
          { error: 'Your workspace is temporarily unavailable. Please retry.' },
          {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
          },
        );
      }
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;

export default {
  scheduled(controller, env) {
    const scoped = releaseEnvironment(env);
    return withEnv(scoped, () =>
      handler.scheduled(controller, scoped),
    ) as Promise<void>;
  },
  fetch(request, env, ctx) {
    const scoped = releaseEnvironment(env);
    return withEnv(scoped, () =>
      handler.fetch(request, scoped, ctx),
    ) as Promise<Response>;
  },
} satisfies ExportedHandler<Cloudflare.Env>;
