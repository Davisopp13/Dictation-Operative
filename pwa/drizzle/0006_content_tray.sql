CREATE TABLE content_items (
  id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CONSTRAINT content_items_kind CHECK(kind IN ('file','link')),
  name TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0 CONSTRAINT content_items_size CHECK(size>=0 AND size<=50000000),
  url TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CONSTRAINT content_items_state CHECK(state IN ('uploading','writing','ready')),
  expires_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX content_items_owner_created ON content_items(owner,created_at);
--> statement-breakpoint
CREATE TABLE content_deletion_queue (
  object_key TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  size INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER content_items_queue_delete AFTER DELETE ON content_items
WHEN OLD.object_key<>''
BEGIN
  INSERT OR IGNORE INTO content_deletion_queue(object_key,owner,size)
  VALUES(OLD.object_key,OLD.owner,OLD.size);
END;

--> statement-breakpoint
CREATE INDEX content_deletion_queue_owner ON content_deletion_queue(owner);
