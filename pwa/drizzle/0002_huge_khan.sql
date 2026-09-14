CREATE TABLE `clipboard_images` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clipboard_images_owner_created` ON `clipboard_images` (`owner`,`created_at`);