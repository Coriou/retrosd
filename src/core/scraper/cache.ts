/**
 * Game cache for ScreenScraper lookups (SQLite-backed)
 *
 * Caches game data to avoid redundant API calls.
 * Provides the same API as the previous JSON-based cache for compatibility.
 */

import { eq, sql } from "drizzle-orm"
import { getDb, scraperCache } from "../../db/index.js"
import type { DbClient } from "../../db/index.js"
import type { GameCacheEntry } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Partial media URL record for storage */
type MediaUrlRecord = Record<string, string>

// ─────────────────────────────────────────────────────────────────────────────
// GameCache Class
// ─────────────────────────────────────────────────────────────────────────────

export class GameCache {
	private db: DbClient
	private dbPath: string

	/**
	 * Create a new cache instance backed by SQLite.
	 *
	 * @param dbPath - Path to the SQLite database file
	 */
	constructor(dbPath: string) {
		this.dbPath = dbPath
		this.db = getDb(dbPath)
	}

	/**
	 * Get a cached entry by key.
	 *
	 * @param key - Cache key (generated via makeKey)
	 * @returns Cached game entry or undefined if not found
	 */
	get(key: string): GameCacheEntry | undefined {
		if (!key) return undefined

		const row = this.db
			.select()
			.from(scraperCache)
			.where(eq(scraperCache.cacheKey, key))
			.get()

		if (!row) return undefined

		// Reconstruct GameCacheEntry from database row
		return this.rowToEntry(row)
	}

	/**
	 * Set a cache entry.
	 *
	 * @param key - Cache key (generated via makeKey)
	 * @param entry - Game data to cache
	 */
	set(key: string, entry: GameCacheEntry): void {
		if (!key) return

		const now = new Date().toISOString()
		const mediaUrls = this.extractMediaUrls(entry)

		// Upsert using INSERT OR REPLACE
		this.db
			.insert(scraperCache)
			.values({
				cacheKey: key,
				gameId: entry.id ? parseInt(entry.id, 10) : null,
				gameName: entry.name,
				mediaUrls: mediaUrls as MediaUrlRecord,
				rawResponse: entry as unknown as Record<string, unknown>,
				scrapedAt: now,
				expiresAt: this.calculateExpiry(now),
			})
			.onConflictDoUpdate({
				target: scraperCache.cacheKey,
				set: {
					gameId: entry.id ? parseInt(entry.id, 10) : null,
					gameName: entry.name,
					mediaUrls,
					rawResponse: entry as unknown as Record<string, unknown>,
					scrapedAt: now,
					expiresAt: this.calculateExpiry(now),
				},
			})
			.run()
	}

	/**
	 * Flush the cache to disk.
	 *
	 * No-op for SQLite — writes are immediate with WAL mode.
	 */
	flush(): void {
		// SQLite handles persistence automatically
	}

	/**
	 * Load cache from storage.
	 *
	 * No-op for SQLite — data is always persistent.
	 */
	load(): void {
		// SQLite data is always available
	}

	/**
	 * Save cache to storage.
	 *
	 * No-op for SQLite — writes are immediate.
	 */
	save(): void {
		// SQLite handles persistence automatically
	}

	/**
	 * Get the number of cached entries.
	 */
	get size(): number {
		const result = this.db
			.select({ count: sql<number>`count(*)` })
			.from(scraperCache)
			.get()

		return result?.count ?? 0
	}

	/**
	 * Generate a cache key from ROM identifiers.
	 * Priority: SHA1 > CRC32 > Name+Size
	 */
	static makeKey(
		systemId: number,
		sha1?: string,
		crc32?: string,
		romName?: string,
		size?: number,
	): string {
		if (sha1) return `${systemId}:sha1:${sha1}`
		if (crc32) return `${systemId}:crc32:${crc32}`
		if (romName) {
			const normalized = romName.toLowerCase().replace(/\s+/g, " ").trim()
			const sizeSuffix = size ? `:${size}` : ""
			return `${systemId}:name:${normalized}${sizeSuffix}`
		}
		return ""
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Private Helpers
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Convert a database row to a GameCacheEntry.
	 */
	private rowToEntry(row: typeof scraperCache.$inferSelect): GameCacheEntry {
		// If we have the full raw response, use it
		if (row.rawResponse && typeof row.rawResponse === "object") {
			const raw = row.rawResponse as GameCacheEntry
			// Ensure timestamp is present
			if (!raw.timestamp) {
				raw.timestamp = row.scrapedAt
					? new Date(row.scrapedAt).getTime()
					: Date.now()
			}
			return raw
		}

		// Reconstruct from individual fields
		const m = (row.mediaUrls ?? {}) as MediaUrlRecord

		return {
			id: row.gameId?.toString() ?? "",
			name: row.gameName ?? "",
			region: "",
			media: {
				...(m["boxFront"] && {
					boxFront: { url: m["boxFront"], format: "png" },
				}),
				...(m["boxBack"] && { boxBack: { url: m["boxBack"], format: "png" } }),
				...(m["screenshot"] && {
					screenshot: { url: m["screenshot"], format: "png" },
				}),
				...(m["video"] && { video: { url: m["video"], format: "mp4" } }),
			},
			timestamp: row.scrapedAt ? new Date(row.scrapedAt).getTime() : Date.now(),
		}
	}

	/**
	 * Extract media URLs from a game entry for storage.
	 * Filters out undefined values for schema compatibility.
	 */
	private extractMediaUrls(entry: GameCacheEntry): MediaUrlRecord {
		const result: MediaUrlRecord = {}
		if (entry.media.boxFront?.url) result["boxFront"] = entry.media.boxFront.url
		if (entry.media.boxBack?.url) result["boxBack"] = entry.media.boxBack.url
		if (entry.media.screenshot?.url)
			result["screenshot"] = entry.media.screenshot.url
		if (entry.media.video?.url) result["video"] = entry.media.video.url
		return result
	}

	/**
	 * Calculate cache expiry date (30 days from now).
	 */
	private calculateExpiry(now: string): string {
		const date = new Date(now)
		date.setDate(date.getDate() + 30)
		return date.toISOString()
	}
}
