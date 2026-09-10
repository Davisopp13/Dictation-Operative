CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`original` text NOT NULL,
	`segments` text NOT NULL,
	`versions` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clips_owner_updated` ON `clips` (`owner`,`updated_at`);--> statement-breakpoint
CREATE INDEX `clips_owner_pinned` ON `clips` (`owner`,`pinned`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`owner` text PRIMARY KEY NOT NULL,
	`encrypted_key` text,
	`consent` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`owner` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`owner`, `window`)
);
