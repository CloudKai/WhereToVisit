CREATE TABLE `trip_collaboration` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
