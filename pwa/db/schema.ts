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
    collectionSynced: integer('collection_synced').notNull().default(0),
    tags: text('tags').notNull().default('[]'),
    pinned: integer('pinned').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    clipboardItem: integer('clipboard_item').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('clips_owner_updated').on(table.owner, table.updatedAt),
    index('clips_collection_pending').on(table.owner, table.collectionSynced, table.id),
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
    itemRevision: integer('item_revision').notNull().default(1),
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
  itemRevision: integer('item_revision').notNull().default(1),
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

// One counter per workspace. Migrations 0007/0009 cover source, pile and
// cleanup-setting changes atomically, including scheduled cleanup.
export const workspaceRevision = sqliteTable('workspace_revision', {
  owner: text('owner').primaryKey(),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(0),
});

// Shared references never copy source content or bytes. SQL guards/triggers live
// in 0009; raw SQL is used for the bounded membership CAS transaction.
export const piles = sqliteTable(
  'piles',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull().default('blue'),
    revision: integer('revision').notNull().default(1),
    updatedAt: integer('updated_at').notNull(),
    createdAt: integer('created_at'),
    writeToken: text('write_token').notNull().default(''),
  },
  (t) => [index('piles_owner').on(t.owner)],
);
export const pileMembers = sqliteTable(
  'pile_members',
  {
    pileId: text('pile_id')
      .notNull()
      .references(() => piles.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    kind: text('kind').notNull(),
    itemId: text('item_id').notNull(),
    position: integer('position').notNull(),
    active: integer('active').notNull().default(1),
    lastOperation: text('last_operation').notNull(),
    manual: integer('manual'),
    collectionKey: text('collection_key'),
  },
  (t) => [
    primaryKey({ columns: [t.pileId, t.kind, t.itemId] }),
    index('pile_members_source').on(t.owner, t.kind, t.itemId, t.active),
  ],
);
export const pileOperations = sqliteTable(
  'pile_operations',
  {
    owner: text('owner').notNull(),
    operationId: text('operation_id').notNull(),
    pileId: text('pile_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: text('result').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.operationId] })],
);
export const itemDeletions = sqliteTable(
  'item_deletions',
  {
    owner: text('owner').notNull(),
    kind: text('kind').notNull(),
    itemId: text('item_id').notNull(),
    reason: text('reason').notNull(),
    deletedAt: integer('deleted_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.kind, t.itemId] })],
);

// A null pile is an intentional, permanent suppression, never an unmapped key.
export const collectionMappings = sqliteTable('collection_mappings', {
  owner: text('owner').notNull(),
  collectionKey: text('collection_key').notNull(),
  pileId: text('pile_id').unique(),
}, (t) => [primaryKey({ columns: [t.owner, t.collectionKey] })]);
