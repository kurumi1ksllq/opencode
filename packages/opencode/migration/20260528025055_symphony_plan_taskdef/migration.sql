CREATE TABLE `symphony_plan` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`goal` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_symphony_plan_workspace_id_symphony_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `symphony_workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `symphony_taskdef` (
	`id` text PRIMARY KEY,
	`plan_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`prompt_template` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`assigned_to` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_symphony_taskdef_plan_id_symphony_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `symphony_plan`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `symphony_plan_workspace_idx` ON `symphony_plan` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `symphony_plan_status_idx` ON `symphony_plan` (`status`);--> statement-breakpoint
CREATE INDEX `symphony_taskdef_plan_idx` ON `symphony_taskdef` (`plan_id`);--> statement-breakpoint
CREATE INDEX `symphony_taskdef_status_idx` ON `symphony_taskdef` (`status`);--> statement-breakpoint
DROP TABLE `session_share`;