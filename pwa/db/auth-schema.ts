import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const dates = () => ({
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export const user = sqliteTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  ...dates(),
});
export const session = sqliteTable('auth_session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  ...dates(),
}, (t) => [index('auth_session_user').on(t.userId)]);
export const account = sqliteTable('auth_account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  ...dates(),
}, (t) => [index('auth_account_user').on(t.userId), uniqueIndex('auth_account_provider').on(t.providerId, t.accountId)]);
export const verification = sqliteTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ...dates(),
}, (t) => [index('auth_verification_identifier').on(t.identifier)]);
export const authThrottle = sqliteTable('auth_throttle', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  startedAt: integer('started_at').notNull(),
});
// Links require proof of BOTH sessions, never an unverified email match.
export const legacyOwner = sqliteTable('auth_legacy_owner', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull().unique(),
});
export const sharedUsage = sqliteTable('shared_ai_usage', {
  key: text('key').primaryKey(),
  day: integer('day').notNull(),
  count: integer('count').notNull(),
});
