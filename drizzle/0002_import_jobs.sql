CREATE TABLE `import_attempts` (
	`session_digest` text NOT NULL,
	`ip_digest` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_attempts_time` ON `import_attempts` (`created_at`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_digest` text NOT NULL,
	`source_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`session_digest`) REFERENCES `import_sessions`(`digest`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_jobs_owner` ON `import_jobs` (`session_digest`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_provider_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`backoff_until` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "single_provider_state" CHECK("import_provider_state"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `import_sessions` (
	`digest` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);

--> statement-breakpoint
INSERT INTO import_provider_state(id, backoff_until) VALUES(1, 0);
