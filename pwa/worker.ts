import app from 'vinext/server/fetch-handler';
import { handleWorkspaceRequest } from './lib/workspace-request';

export default {
  async fetch(request, env, ctx) {
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
