CREATE TABLE `workspace_tools` (
	`owner` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `clips` ADD `collection` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `tags` text DEFAULT '[]' NOT NULL;