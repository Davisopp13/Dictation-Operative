CREATE TABLE `collection_mappings` (
	`owner` text NOT NULL,
	`collection_key` text NOT NULL,
	`pile_id` text,
	PRIMARY KEY(`owner`, `collection_key`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_mappings_pile_id_unique` ON `collection_mappings` (`pile_id`);--> statement-breakpoint
ALTER TABLE `clips` ADD `collection_synced` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pile_members` ADD `manual` integer;--> statement-breakpoint
ALTER TABLE `pile_members` ADD `collection_key` text;
--> statement-breakpoint
-- NULL manual provenance inherits the pre-P2 active flag until the slot changes.
-- No all-account row rewrite or source backfill runs during this schema upgrade.
CREATE INDEX clips_collection_pending ON clips(owner,collection_synced,id);
--> statement-breakpoint
CREATE TRIGGER collection_mapping_create AFTER INSERT ON collection_mappings
WHEN NEW.pile_id IS NOT NULL
BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM piles WHERE owner=NEW.owner)>=100 THEN RAISE(ABORT,'collection_capacity') END;
 INSERT INTO piles(id,owner,name,color,revision,created_at,updated_at)
 VALUES(NEW.pile_id,NEW.owner,
 CASE WHEN NEW.collection_key NOT GLOB '*[^ -~]*' AND length(trim(NEW.collection_key))>0 AND instr(NEW.collection_key,char(0))=0
 THEN substr(trim(NEW.collection_key),1,60)
 ELSE 'Collection '||substr(hex(CAST(NEW.collection_key AS BLOB)),1,32) END,
 'blue',1,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000);
END;
--> statement-breakpoint
-- Retain exact identity after deletion. No pile deletion Undo or automatic reuse.
CREATE TRIGGER collection_mapping_suppress BEFORE DELETE ON piles
BEGIN
 UPDATE collection_mappings SET pile_id=NULL WHERE owner=OLD.owner AND pile_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER clips_collection_insert AFTER INSERT ON clips
WHEN NEW.collection_synced=1
BEGIN
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE owner=NEW.owner AND id IN (SELECT pile_id FROM pile_members WHERE owner=NEW.owner AND kind='text' AND item_id=NEW.id AND collection_key IS NOT NULL AND collection_key<>NEW.collection);
 UPDATE pile_members SET collection_key=NULL,active=COALESCE(manual,active),manual=COALESCE(manual,active),last_operation='collection:'||lower(hex(randomblob(16)))
 WHERE owner=NEW.owner AND kind='text' AND item_id=NEW.id AND collection_key IS NOT NULL AND collection_key<>NEW.collection;
 INSERT INTO collection_mappings(owner,collection_key,pile_id)
 SELECT NEW.owner,NEW.collection,lower(hex(randomblob(16))) WHERE NEW.collection<>''
 ON CONFLICT(owner,collection_key) DO NOTHING;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection AND c.pile_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id)
 AND (SELECT count(*) FROM pile_members m WHERE m.pile_id=c.pile_id)>=500
 ) THEN RAISE(ABORT,'collection_capacity') END;
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE owner=NEW.owner AND id IN (
 SELECT c.pile_id FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection
 AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id AND m.collection_key=NEW.collection));
 INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation,manual,collection_key)
 SELECT c.pile_id,NEW.owner,'text',NEW.id,COALESCE((SELECT max(position)+1 FROM pile_members WHERE pile_id=c.pile_id),0),1,'collection:'||lower(hex(randomblob(16))),0,NEW.collection
 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection AND c.pile_id IS NOT NULL
 ON CONFLICT(pile_id,kind,item_id) DO UPDATE SET manual=COALESCE(pile_members.manual,pile_members.active),active=1,collection_key=excluded.collection_key,last_operation=excluded.last_operation
 WHERE pile_members.collection_key IS NOT excluded.collection_key;
END;
--> statement-breakpoint
CREATE TRIGGER clips_collection_update AFTER UPDATE OF collection,collection_synced ON clips
WHEN NEW.collection_synced=1 AND (OLD.collection_synced=0 OR OLD.collection<>NEW.collection)
BEGIN
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE owner=NEW.owner AND id IN (SELECT pile_id FROM pile_members WHERE owner=NEW.owner AND kind='text' AND item_id=NEW.id AND collection_key IS NOT NULL AND collection_key<>NEW.collection);
 UPDATE pile_members SET collection_key=NULL,active=COALESCE(manual,active),manual=COALESCE(manual,active),last_operation='collection:'||lower(hex(randomblob(16)))
 WHERE owner=NEW.owner AND kind='text' AND item_id=NEW.id AND collection_key IS NOT NULL AND collection_key<>NEW.collection;
 INSERT INTO collection_mappings(owner,collection_key,pile_id)
 SELECT NEW.owner,NEW.collection,lower(hex(randomblob(16))) WHERE NEW.collection<>''
 ON CONFLICT(owner,collection_key) DO NOTHING;
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection AND c.pile_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id)
 AND (SELECT count(*) FROM pile_members m WHERE m.pile_id=c.pile_id)>=500
 ) THEN RAISE(ABORT,'collection_capacity') END;
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE owner=NEW.owner AND id IN (
 SELECT c.pile_id FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection
 AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id AND m.collection_key=NEW.collection));
 INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation,manual,collection_key)
 SELECT c.pile_id,NEW.owner,'text',NEW.id,COALESCE((SELECT max(position)+1 FROM pile_members WHERE pile_id=c.pile_id),0),1,'collection:'||lower(hex(randomblob(16))),0,NEW.collection
 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection AND c.pile_id IS NOT NULL
 ON CONFLICT(pile_id,kind,item_id) DO UPDATE SET manual=COALESCE(pile_members.manual,pile_members.active),active=1,collection_key=excluded.collection_key,last_operation=excluded.last_operation
 WHERE pile_members.collection_key IS NOT excluded.collection_key;
END;
--> statement-breakpoint
-- This view is the current workset, not a pagination snapshot. Suppressed
-- keys are observable but cannot recreate a deleted pile. All limits count slots.
CREATE VIEW collection_backfill_pending AS
SELECT t.owner,t.id,t.collection,c.pile_id,
 CASE WHEN c.owner IS NOT NULL AND c.pile_id IS NULL THEN 'suppressed'
 WHEN c.owner IS NULL AND (SELECT count(*) FROM piles p WHERE p.owner=t.owner)>=100 THEN 'pile_capacity'
 WHEN c.pile_id IS NOT NULL AND (SELECT count(*) FROM pile_members m WHERE m.pile_id=c.pile_id)>=500
 AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=t.id) THEN 'member_capacity'
 ELSE 'ready' END AS state
FROM clips t LEFT JOIN collection_mappings c ON c.owner=t.owner AND c.collection_key=t.collection
WHERE t.collection_synced=0 AND t.collection<>'';
