CREATE TABLE `imported_source_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organiser_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`organiser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trip_save_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`session_digest` text NOT NULL,
	`organiser_user_id` text,
	`document` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`organiser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`organiser_user_id` text NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`organiser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trips_owner` ON `trips` (`organiser_user_id`);