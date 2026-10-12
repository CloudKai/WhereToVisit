CREATE TABLE `guest_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `guest_participants_trip` ON `guest_participants` (`trip_id`);--> statement-breakpoint
CREATE TABLE `guest_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_digest` text NOT NULL,
	`participant_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `guest_participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `guest_sessions_token` ON `guest_sessions` (`token_digest`);--> statement-breakpoint
CREATE TABLE `trip_invitations` (
	`trip_id` text PRIMARY KEY NOT NULL,
	`token_digest` text NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_invitations_token_digest_unique` ON `trip_invitations` (`token_digest`);