CREATE TABLE `symphony_job` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`payload` text NOT NULL DEFAULT '{}',
	`priority` integer NOT NULL DEFAULT 5,
	`status` text NOT NULL,
	`worktree_name` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `symphony_workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL REFERENCES `symphony_job`(`id`),
	`directory` text NOT NULL,
	`branch` text NOT NULL,
	`status` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
