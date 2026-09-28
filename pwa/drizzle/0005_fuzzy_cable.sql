CREATE TABLE `clipboard_image_deletion_queue` (
	`object_key` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE `clipboard_images` ADD `pinned` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `clipboard_item` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `preferences` ADD `clipboard_daily_cleanup` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Keep object cleanup durable and atomic with metadata deletion, including
-- manual deletes. R2 keys are immutable and unique for each saved image.
CREATE TRIGGER clipboard_images_queue_delete AFTER DELETE ON clipboard_images
BEGIN
  INSERT OR IGNORE INTO clipboard_image_deletion_queue (object_key) VALUES (OLD.object_key);
END;
