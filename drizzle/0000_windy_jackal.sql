CREATE TABLE `local_roms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`remote_rom_id` integer,
	`local_path` text NOT NULL,
	`sha1` text,
	`crc32` text,
	`file_size` integer,
	`downloaded_at` text,
	`verified_at` text,
	FOREIGN KEY (`remote_rom_id`) REFERENCES `remote_roms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_local_roms_path` ON `local_roms` (`local_path`);--> statement-breakpoint
CREATE INDEX `idx_local_roms_remote` ON `local_roms` (`remote_rom_id`);--> statement-breakpoint
CREATE INDEX `idx_local_roms_sha1` ON `local_roms` (`sha1`);--> statement-breakpoint
CREATE TABLE `remote_roms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`system` text NOT NULL,
	`source` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer,
	`last_modified` text,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_remote_roms_system` ON `remote_roms` (`system`);--> statement-breakpoint
CREATE INDEX `idx_remote_roms_filename` ON `remote_roms` (`filename`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_remote_roms_unique` ON `remote_roms` (`system`,`source`,`filename`);--> statement-breakpoint
CREATE TABLE `rom_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`remote_rom_id` integer NOT NULL,
	`title` text,
	`regions` text,
	`languages` text,
	`revision` integer,
	`is_beta` integer DEFAULT false,
	`is_demo` integer DEFAULT false,
	`is_proto` integer DEFAULT false,
	`is_sample` integer DEFAULT false,
	`is_unlicensed` integer DEFAULT false,
	`is_homebrew` integer DEFAULT false,
	`is_hack` integer DEFAULT false,
	`is_virtual` integer DEFAULT false,
	`is_compilation` integer DEFAULT false,
	FOREIGN KEY (`remote_rom_id`) REFERENCES `remote_roms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rom_metadata_title` ON `rom_metadata` (`title`);--> statement-breakpoint
CREATE INDEX `idx_rom_metadata_remote_rom` ON `rom_metadata` (`remote_rom_id`);--> statement-breakpoint
CREATE TABLE `scraper_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cache_key` text NOT NULL,
	`game_id` integer,
	`game_name` text,
	`media_urls` text,
	`raw_response` text,
	`scraped_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scraper_cache_cache_key_unique` ON `scraper_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_scraper_cache_expires` ON `scraper_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`system` text NOT NULL,
	`source` text NOT NULL,
	`remote_last_modified` text,
	`local_last_synced` text,
	`remote_count` integer,
	`status` text DEFAULT 'stale',
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_state_unique` ON `sync_state` (`system`,`source`);