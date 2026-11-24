import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export * from './auth-schema';
export const clips = sqliteTable(
  'clips',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    original: text('original').notNull(),
    segments: text('segments').notNull(),
    versions: text('versions').notNull(),
    context: text('context').notNull().default(''),
    collection: text('collection').notNull().default(''),
    tags: text('tags').notNull().default('[]'),
    pinned: integer('pinned').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    clipboardItem: integer('clipboard_item').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('clips_owner_updated').on(table.owner, table.updatedAt),
    index('clips_owner_pinned').on(table.owner, table.pinned),
  ],
);
export const preferences = sqliteTable('preferences', {
  owner: text('owner').primaryKey(),
  encryptedKey: text('encrypted_key'),
  model: text('model').notNull().default('openai/gpt-oss-120b'),
  consent: integer('consent').notNull().default(0),
  clipboardDailyCleanup: integer('clipboard_daily_cleanup').notNull().default(0),
});
export const usage = sqliteTable(
  'usage',
  {
    owner: text('owner').notNull(),
    window: integer('window').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.window] })],
);

export const workspaceTools = sqliteTable('workspace_tools', {
  owner: text('owner').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(1),
});

export const clipboardImages = sqliteTable(
  'clipboard_images',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    objectKey: text('object_key').notNull(),
    pinned: integer('pinned').notNull().default(0),
    size: integer('size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('clipboard_images_owner_created').on(table.owner, table.createdAt),
  ],
);

export const clipboardImageDeletionQueue = sqliteTable('clipboard_image_deletion_queue', {
  objectKey: text('object_key').primaryKey(),
});

export const contentItems = sqliteTable('content_items', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  filename: text('filename').notNull().default(''),
  mime: text('mime').notNull().default('application/octet-stream'),
  size: integer('size').notNull().default(0),
  url: text('url').notNull().default(''),
  objectKey: text('object_key').notNull().default(''),
  pinned: integer('pinned').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  state: text('state').notNull(),
  expiresAt: integer('expires_at').notNull().default(0),
}, (table) => [
  index('content_items_owner_created').on(table.owner,table.createdAt),
  check('content_items_kind',sql`${table.kind} IN ('file','link')`),
  check('content_items_state',sql`${table.state} IN ('uploading','writing','ready')`),
  check('content_items_size',sql`${table.size}>=0 AND ${table.size}<=50000000`),
]);
export const contentDeletionQueue = sqliteTable('content_deletion_queue', {
  objectKey: text('object_key').primaryKey(),
  owner: text('owner').notNull(),
  size: integer('size').notNull(),
}, (table) => [index('content_deletion_queue_owner').on(table.owner)]);
