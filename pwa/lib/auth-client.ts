'use client';
import { createAuthClient } from 'better-auth/react';
import { usernameClient } from 'better-auth/client/plugins';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
// oauthProviderClient carries a pending native sign-in request, held in the
// page's query string, through sign-in and consent.
export const authClient = createAuthClient({
  plugins: [usernameClient(), oauthProviderClient()],
});
