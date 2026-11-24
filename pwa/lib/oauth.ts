/**
 * Native sign-in. A native app signs the user in through the system browser
 * (authorization code with S256 PKCE, public client, no secret) and then calls
 * /api/v1 with a short-lived bearer access token.
 */

/**
 * The audience of an access token for /api/v1. It is a URN, not a URL, so the
 * same identifier is valid on every host this workspace is served from. The
 * matching row is seeded by migration 0008.
 */
export const WORKSPACE_RESOURCE = 'urn:catchall-desk:workspace-api';
/** The scope a token must carry to read and change a workspace. */
export const WORKSPACE_SCOPE = 'workspace';
export const OAUTH_SCOPES = ['openid', 'email', 'offline_access', WORKSPACE_SCOPE];
/**
 * Access tokens are signed and checked without a database lookup, so one
 * cannot be recalled before it expires. Keeping them short bounds that window;
 * the refresh token, which can be revoked, renews them.
 */
export const ACCESS_TOKEN_SECONDS = 15 * 60;
