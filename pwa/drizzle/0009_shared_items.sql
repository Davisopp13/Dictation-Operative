CREATE TABLE piles (
 id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
 color TEXT NOT NULL DEFAULT 'blue' CHECK(color IN ('blue','glow','sky','mint','sunny','paper')),
 revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, write_token TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX piles_owner ON piles(owner);
--> statement-breakpoint
CREATE TABLE pile_members (
 pile_id TEXT NOT NULL REFERENCES piles(id) ON DELETE CASCADE, owner TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('text','image','document')), item_id TEXT NOT NULL,
 position INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), last_operation TEXT NOT NULL,
 PRIMARY KEY(pile_id,kind,item_id)
);
--> statement-breakpoint
CREATE INDEX pile_members_source ON pile_members(owner,kind,item_id,active);
--> statement-breakpoint
CREATE TABLE pile_operations (
 owner TEXT NOT NULL, operation_id TEXT NOT NULL, pile_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(owner,operation_id)
);
--> statement-breakpoint
CREATE TABLE item_deletions (
 owner TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('deleted','cleared')), deleted_at INTEGER NOT NULL,
 PRIMARY KEY(owner,kind,item_id)
);
--> statement-breakpoint
ALTER TABLE clipboard_images ADD COLUMN item_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TRIGGER clipboard_images_item_revision AFTER UPDATE ON clipboard_images
 WHEN NEW.item_revision=OLD.item_revision
 BEGIN UPDATE clipboard_images SET item_revision=OLD.item_revision+1 WHERE id=NEW.id; END;
--> statement-breakpoint
ALTER TABLE content_items ADD COLUMN item_revision INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TRIGGER content_items_item_revision AFTER UPDATE ON content_items
 WHEN NEW.item_revision=OLD.item_revision
 BEGIN UPDATE content_items SET item_revision=OLD.item_revision+1 WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER pile_members_validate_insert BEFORE INSERT ON pile_members
 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM piles WHERE id=NEW.pile_id AND owner=NEW.owner) THEN RAISE(ABORT,'pile_gone') END;
 SELECT CASE WHEN NOT (
 (NEW.kind='text' AND EXISTS(SELECT 1 FROM clips WHERE id=NEW.item_id AND owner=NEW.owner)) OR
 (NEW.kind='image' AND EXISTS(SELECT 1 FROM clipboard_images WHERE id=NEW.item_id AND owner=NEW.owner)) OR
 (NEW.kind='document' AND EXISTS(SELECT 1 FROM content_items WHERE id=NEW.item_id AND owner=NEW.owner AND state='ready'))
 ) THEN RAISE(ABORT,'item_gone') END;
 END;
--> statement-breakpoint
CREATE TRIGGER pile_members_validate_update BEFORE UPDATE ON pile_members
 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM piles WHERE id=NEW.pile_id AND owner=NEW.owner) THEN RAISE(ABORT,'pile_gone') END;
 SELECT CASE WHEN NOT (
 (NEW.kind='text' AND EXISTS(SELECT 1 FROM clips WHERE id=NEW.item_id AND owner=NEW.owner)) OR
 (NEW.kind='image' AND EXISTS(SELECT 1 FROM clipboard_images WHERE id=NEW.item_id AND owner=NEW.owner)) OR
 (NEW.kind='document' AND EXISTS(SELECT 1 FROM content_items WHERE id=NEW.item_id AND owner=NEW.owner AND state='ready'))
 ) THEN RAISE(ABORT,'item_gone') END;
 END;
--> statement-breakpoint
CREATE TRIGGER clips_remove_references AFTER DELETE ON clips
 BEGIN
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE id IN (SELECT pile_id FROM pile_members WHERE owner=OLD.owner AND kind='text' AND item_id=OLD.id);
 DELETE FROM pile_members WHERE owner=OLD.owner AND kind='text' AND item_id=OLD.id;
 INSERT OR IGNORE INTO item_deletions VALUES(OLD.owner,'text',OLD.id,'deleted',CAST(strftime('%s','now') AS INTEGER)*1000);
 END;
--> statement-breakpoint
CREATE TRIGGER clips_clear_tombstone AFTER INSERT ON clips
 BEGIN DELETE FROM item_deletions WHERE owner=NEW.owner AND kind='text' AND item_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER clipboard_images_remove_references AFTER DELETE ON clipboard_images
 BEGIN
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE id IN (SELECT pile_id FROM pile_members WHERE owner=OLD.owner AND kind='image' AND item_id=OLD.id);
 DELETE FROM pile_members WHERE owner=OLD.owner AND kind='image' AND item_id=OLD.id;
 INSERT OR IGNORE INTO item_deletions VALUES(OLD.owner,'image',OLD.id,'deleted',CAST(strftime('%s','now') AS INTEGER)*1000);
 END;
--> statement-breakpoint
CREATE TRIGGER clipboard_images_clear_tombstone AFTER INSERT ON clipboard_images
 BEGIN DELETE FROM item_deletions WHERE owner=NEW.owner AND kind='image' AND item_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER content_items_remove_references AFTER DELETE ON content_items
 BEGIN
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE id IN (SELECT pile_id FROM pile_members WHERE owner=OLD.owner AND kind='document' AND item_id=OLD.id);
 DELETE FROM pile_members WHERE owner=OLD.owner AND kind='document' AND item_id=OLD.id;
 INSERT OR IGNORE INTO item_deletions VALUES(OLD.owner,'document',OLD.id,'deleted',CAST(strftime('%s','now') AS INTEGER)*1000);
 END;
--> statement-breakpoint
CREATE TRIGGER content_items_clear_tombstone AFTER INSERT ON content_items
 BEGIN DELETE FROM item_deletions WHERE owner=NEW.owner AND kind='document' AND item_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER piles_revision_insert AFTER INSERT ON piles
 BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
 END;
--> statement-breakpoint
CREATE TRIGGER piles_revision_update AFTER UPDATE ON piles
 WHEN NEW.revision<>OLD.revision OR NEW.name<>OLD.name OR NEW.color<>OLD.color
 BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
 END;
--> statement-breakpoint
CREATE TRIGGER piles_revision_delete AFTER DELETE ON piles
 BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(OLD.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
 END;
--> statement-breakpoint
CREATE TRIGGER preferences_cleanup_revision_insert AFTER INSERT ON preferences
 BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
 END;
--> statement-breakpoint
CREATE TRIGGER preferences_cleanup_revision_update AFTER UPDATE ON preferences
 BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
 END;
--> statement-breakpoint
CREATE TRIGGER preferences_cleanup_revision_delete AFTER DELETE ON preferences
 BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(OLD.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
 END;
--> statement-breakpoint
CREATE TRIGGER clips_shared_revision_insert AFTER INSERT ON clips
BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER clips_shared_revision_update AFTER UPDATE ON clips
BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER clips_shared_revision_delete AFTER DELETE ON clips
BEGIN
 INSERT INTO workspace_revision(owner,revision,updated_at) VALUES(OLD.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
 ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
