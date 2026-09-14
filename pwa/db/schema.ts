import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
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
    size: integer('size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('clipboard_images_owner_created').on(table.owner, table.createdAt),
  ],
);
