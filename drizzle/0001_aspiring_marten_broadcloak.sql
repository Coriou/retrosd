ALTER TABLE `local_roms` ADD `system` text;--> statement-breakpoint
ALTER TABLE `local_roms` ADD `filename` text;--> statement-breakpoint
CREATE INDEX `idx_local_roms_system` ON `local_roms` (`system`);--> statement-breakpoint
CREATE INDEX `idx_local_roms_filename` ON `local_roms` (`filename`);