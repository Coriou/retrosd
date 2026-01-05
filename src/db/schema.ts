/**
 * SQLite Database Schema for RetroSD
 *
 * This schema provides:
 * - Remote catalog storage (Myrient listings)
 * - Parsed ROM metadata for fast search
 * - Local collection tracking
 * - Scraper cache
 * - Sync state tracking
 */

import {
	sqliteTable,
	text,
	integer,
	index,
	uniqueIndex,
} from "drizzle-orm/sqlite-core"

// ═══════════════════════════════════════════════════════════════════════════════
// Remote Catalog
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Stores ROMs from remote sources (Myrient, etc.)
 * Synced periodically to enable offline browsing and fast search.
 */
export const remoteRoms = sqliteTable(
	"remote_roms",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** System identifier (e.g., "GB", "GBA", "SNES") */
		system: text("system").notNull(),
		/** Source identifier (e.g., "myrient", "internet-archive") */
		source: text("source").notNull(),
		/** Remote filename including extension */
		filename: text("filename").notNull(),
		/** File size in bytes */
		size: integer("size"),
		/** Remote last-modified timestamp (ISO 8601) */
		lastModified: text("last_modified"),
		/** When this record was synced locally (ISO 8601) */
		lastSyncedAt: text("last_synced_at"),
	},
	table => [
		index("idx_remote_roms_system").on(table.system),
		index("idx_remote_roms_filename").on(table.filename),
		uniqueIndex("idx_remote_roms_unique").on(
			table.system,
			table.source,
			table.filename,
		),
	],
)

// ═══════════════════════════════════════════════════════════════════════════════
// Parsed ROM Metadata
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parsed metadata extracted from ROM filenames using No-Intro naming conventions.
 * Enables rich filtering by region, language, revision, etc.
 */
export const romMetadata = sqliteTable(
	"rom_metadata",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** Reference to the remote ROM entry */
		remoteRomId: integer("remote_rom_id")
			.notNull()
			.references(() => remoteRoms.id, { onDelete: "cascade" }),
		/** Parsed game title (cleaned of region/revision tags) */
		title: text("title"),
		/** JSON array of region codes: ["USA", "Europe", "Japan"] */
		regions: text("regions", { mode: "json" }).$type<string[]>(),
		/** JSON array of language codes: ["En", "Fr", "De"] */
		languages: text("languages", { mode: "json" }).$type<string[]>(),
		/** Revision number (0 = original, 1+ = revisions) */
		revision: integer("revision"),
		/** Pre-release status flags */
		isBeta: integer("is_beta", { mode: "boolean" }).default(false),
		isDemo: integer("is_demo", { mode: "boolean" }).default(false),
		isProto: integer("is_proto", { mode: "boolean" }).default(false),
		isSample: integer("is_sample", { mode: "boolean" }).default(false),
		/** Special ROM types */
		isUnlicensed: integer("is_unlicensed", { mode: "boolean" }).default(false),
		isHomebrew: integer("is_homebrew", { mode: "boolean" }).default(false),
		isHack: integer("is_hack", { mode: "boolean" }).default(false),
		/** Additional metadata flags */
		isVirtual: integer("is_virtual", { mode: "boolean" }).default(false),
		isCompilation: integer("is_compilation", { mode: "boolean" }).default(
			false,
		),
	},
	table => [
		index("idx_rom_metadata_title").on(table.title),
		index("idx_rom_metadata_remote_rom").on(table.remoteRomId),
	],
)

// ═══════════════════════════════════════════════════════════════════════════════
// Local Collection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tracks ROMs that exist in the local collection.
 * Links to remote catalog for update detection.
 */
export const localRoms = sqliteTable(
	"local_roms",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** Optional link to remote catalog (null if local-only) */
		remoteRomId: integer("remote_rom_id").references(() => remoteRoms.id, {
			onDelete: "set null",
		}),
		/** System key for matching when remoteRomId is not known yet */
		system: text("system"),
		/** Remote filename for matching when remoteRomId is not known yet */
		filename: text("filename"),
		/** Full path to the local file */
		localPath: text("local_path").notNull(),
		/** SHA-1 hash for verification */
		sha1: text("sha1"),
		/** CRC32 hash for quick matching */
		crc32: text("crc32"),
		/** Actual file size on disk */
		fileSize: integer("file_size"),
		/** When the file was downloaded (ISO 8601) */
		downloadedAt: text("downloaded_at"),
		/** When the file was last verified against hash (ISO 8601) */
		verifiedAt: text("verified_at"),
	},
	table => [
		index("idx_local_roms_path").on(table.localPath),
		index("idx_local_roms_remote").on(table.remoteRomId),
		index("idx_local_roms_system").on(table.system),
		index("idx_local_roms_filename").on(table.filename),
		index("idx_local_roms_sha1").on(table.sha1),
	],
)

// ═══════════════════════════════════════════════════════════════════════════════
// Scraper Cache
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Caches ScreenScraper API responses to avoid redundant requests.
 * Migrated from JSON file for better query performance.
 */
export const scraperCache = sqliteTable(
	"scraper_cache",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** Unique cache key (typically: system:romname or sha1) */
		cacheKey: text("cache_key").notNull().unique(),
		/** ScreenScraper game ID */
		gameId: integer("game_id"),
		/** Matched game name from ScreenScraper */
		gameName: text("game_name"),
		/** JSON object containing media URLs by type */
		mediaUrls: text("media_urls", { mode: "json" }).$type<
			Record<string, string>
		>(),
		/** Full API response for cache restoration */
		rawResponse: text("raw_response", { mode: "json" }),
		/** When this entry was scraped (ISO 8601) */
		scrapedAt: text("scraped_at").notNull(),
		/** TTL hint: when to consider re-scraping (ISO 8601) */
		expiresAt: text("expires_at"),
	},
	table => [index("idx_scraper_cache_expires").on(table.expiresAt)],
)

// ═══════════════════════════════════════════════════════════════════════════════
// Sync State
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tracks sync state per system/source combination.
 * Used for incremental sync detection.
 */
export const syncState = sqliteTable(
	"sync_state",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** System identifier */
		system: text("system").notNull(),
		/** Source identifier */
		source: text("source").notNull(),
		/** Remote directory last-modified timestamp (ISO 8601) */
		remoteLastModified: text("remote_last_modified"),
		/** When we last synced this system/source (ISO 8601) */
		localLastSynced: text("local_last_synced"),
		/** Number of ROMs in remote catalog */
		remoteCount: integer("remote_count"),
		/** Sync status: "synced" | "stale" | "syncing" | "error" */
		status: text("status").default("stale"),
		/** Error message if sync failed */
		lastError: text("last_error"),
	},
	table => [
		uniqueIndex("idx_sync_state_unique").on(table.system, table.source),
	],
)

// ═══════════════════════════════════════════════════════════════════════════════
// Type Exports
// ═══════════════════════════════════════════════════════════════════════════════

export type RemoteRom = typeof remoteRoms.$inferSelect
export type NewRemoteRom = typeof remoteRoms.$inferInsert

export type RomMetadata = typeof romMetadata.$inferSelect
export type NewRomMetadata = typeof romMetadata.$inferInsert

export type LocalRom = typeof localRoms.$inferSelect
export type NewLocalRom = typeof localRoms.$inferInsert

export type ScraperCacheEntry = typeof scraperCache.$inferSelect
export type NewScraperCacheEntry = typeof scraperCache.$inferInsert

export type SyncState = typeof syncState.$inferSelect
export type NewSyncState = typeof syncState.$inferInsert
