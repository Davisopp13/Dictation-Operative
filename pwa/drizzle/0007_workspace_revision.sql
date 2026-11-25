CREATE TABLE `workspace_revision` (
	`owner` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER clipboard_images_revision_insert AFTER INSERT ON clipboard_images
BEGIN
  INSERT INTO workspace_revision(owner,revision,updated_at)
  VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER clipboard_images_revision_update AFTER UPDATE ON clipboard_images
BEGIN
  INSERT INTO workspace_revision(owner,revision,updated_at)
  VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER clipboard_images_revision_delete AFTER DELETE ON clipboard_images
BEGIN
  INSERT INTO workspace_revision(owner,revision,updated_at)
  VALUES(OLD.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER content_items_revision_insert AFTER INSERT ON content_items
BEGIN
  INSERT INTO workspace_revision(owner,revision,updated_at)
  VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER content_items_revision_update AFTER UPDATE ON content_items
BEGIN
  INSERT INTO workspace_revision(owner,revision,updated_at)
  VALUES(NEW.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER content_items_revision_delete AFTER DELETE ON content_items
BEGIN
  INSERT INTO workspace_revision(owner,revision,updated_at)
  VALUES(OLD.owner,1,CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(owner) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
