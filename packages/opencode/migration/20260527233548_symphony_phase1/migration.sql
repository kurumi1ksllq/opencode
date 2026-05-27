CREATE TABLE `symphony_issue` (
	`id` text PRIMARY KEY,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`issue_number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text NOT NULL,
	`worktree_name` text,
	`metadata` text NOT NULL DEFAULT '{}',
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `symphony_workspace` (
	`id` text PRIMARY KEY,
	`issue_id` text NOT NULL REFERENCES `symphony_issue`(`id`),
	`directory` text NOT NULL,
	`branch` text NOT NULL,
	`status` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
