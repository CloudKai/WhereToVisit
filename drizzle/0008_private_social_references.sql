CREATE TABLE `social_reference_attempts` (
	`session_digest` text NOT NULL,
	`ip_digest` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `social_reference_attempts_time` ON `social_reference_attempts` (`created_at`);--> statement-breakpoint
CREATE TABLE `social_references` (
	`id` text PRIMARY KEY NOT NULL,
	`session_digest` text NOT NULL,
	`platform` text NOT NULL,
	`source_url` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`session_digest`) REFERENCES `import_sessions`(`digest`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_references_owner` ON `social_references` (`session_digest`,`created_at`);--> statement-breakpoint
CREATE INDEX `social_references_expiry` ON `social_references` (`expires_at`);