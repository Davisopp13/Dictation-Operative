-- B1: retain source writes/imports when mapping capacity is full.
-- Replace only the two reconciliation triggers; no rows/slots/receipts are
-- rewritten or compacted. Apply after 0011 before dependent P2 code/activation.
DROP TRIGGER clips_collection_insert;
--> statement-breakpoint
DROP TRIGGER clips_collection_update;
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
 AND (SELECT count(*) FROM piles WHERE owner=NEW.owner)<100
 ON CONFLICT(owner,collection_key) DO NOTHING;
 -- Capacity defers organization, never the source. Suppressed keys are settled
 -- deliberately; absent mappings or full piles retain a pending cleanup hold.
 -- This nested update does not recurse: the reconciliation trigger requires 1.
 UPDATE clips SET collection_synced=0 WHERE owner=NEW.owner AND id=NEW.id
 AND collection_synced=1 AND NEW.collection<>'' AND NOT EXISTS(
 SELECT 1 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection
 AND (c.pile_id IS NULL
 OR EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id)
 OR (SELECT count(*) FROM pile_members m WHERE m.pile_id=c.pile_id)<500));
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE owner=NEW.owner
 AND EXISTS(SELECT 1 FROM clips WHERE owner=NEW.owner AND id=NEW.id AND collection_synced=1)
 AND id IN (
 SELECT c.pile_id FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection
 AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id AND m.collection_key=NEW.collection));
 INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation,manual,collection_key)
 SELECT c.pile_id,NEW.owner,'text',NEW.id,COALESCE((SELECT max(position)+1 FROM pile_members WHERE pile_id=c.pile_id),0),1,'collection:'||lower(hex(randomblob(16))),0,NEW.collection
 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection AND c.pile_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM clips WHERE owner=NEW.owner AND id=NEW.id AND collection_synced=1)
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
 AND (SELECT count(*) FROM piles WHERE owner=NEW.owner)<100
 ON CONFLICT(owner,collection_key) DO NOTHING;
 -- Capacity defers organization, never the source. Suppressed keys are settled
 -- deliberately; absent mappings or full piles retain a pending cleanup hold.
 -- This nested update does not recurse: the reconciliation trigger requires 1.
 UPDATE clips SET collection_synced=0 WHERE owner=NEW.owner AND id=NEW.id
 AND collection_synced=1 AND NEW.collection<>'' AND NOT EXISTS(
 SELECT 1 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection
 AND (c.pile_id IS NULL
 OR EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id)
 OR (SELECT count(*) FROM pile_members m WHERE m.pile_id=c.pile_id)<500));
 UPDATE piles SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE owner=NEW.owner
 AND EXISTS(SELECT 1 FROM clips WHERE owner=NEW.owner AND id=NEW.id AND collection_synced=1)
 AND id IN (
 SELECT c.pile_id FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection
 AND NOT EXISTS(SELECT 1 FROM pile_members m WHERE m.pile_id=c.pile_id AND m.kind='text' AND m.item_id=NEW.id AND m.collection_key=NEW.collection));
 INSERT INTO pile_members(pile_id,owner,kind,item_id,position,active,last_operation,manual,collection_key)
 SELECT c.pile_id,NEW.owner,'text',NEW.id,COALESCE((SELECT max(position)+1 FROM pile_members WHERE pile_id=c.pile_id),0),1,'collection:'||lower(hex(randomblob(16))),0,NEW.collection
 FROM collection_mappings c WHERE c.owner=NEW.owner AND c.collection_key=NEW.collection AND c.pile_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM clips WHERE owner=NEW.owner AND id=NEW.id AND collection_synced=1)
 ON CONFLICT(pile_id,kind,item_id) DO UPDATE SET manual=COALESCE(pile_members.manual,pile_members.active),active=1,collection_key=excluded.collection_key,last_operation=excluded.last_operation
 WHERE pile_members.collection_key IS NOT excluded.collection_key;
END;
