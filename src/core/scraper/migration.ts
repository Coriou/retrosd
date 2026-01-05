/**
 * Legacy JSON Cache Migration
 *
 * Handles one-time migration of existing .screenscraper-cache.json files
 * to the SQLite database.
 */

import { existsSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"
import { getDb, scraperCache } from "../../db/index.js"
import { logger } from "../../logger.js"
import type { GameCacheEntry } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MigrationResult {
	migrated: number
	skipped: number
	errors: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration Function
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_CACHE_FILENAMES = [
	".retrosd-scrape-cache.json",
	".screenscraper-cache.json",
] as const
const MIGRATED_SUFFIX = ".migrated"

/**
 * Migrate legacy JSON cache to SQLite if it exists.
 *
 * @param systemDir - System directory containing the legacy cache file
 * @param dbPath - Path to the SQLite database
 * @returns Migration result with counts
 */
export function migrateJsonCacheIfExists(
	systemDir: string,
	dbPath: string,
): MigrationResult {
	const log = logger.child({ component: "scraper-migrate" })
	let totalMigrated = 0
	let totalSkipped = 0
	let totalErrors = 0

	const db = getDb(dbPath)
	const now = new Date().toISOString()
	const expiresAt = calculateExpiry(now)

	for (const filename of LEGACY_CACHE_FILENAMES) {
		const jsonPath = join(systemDir, filename)

		if (!existsSync(jsonPath)) continue

		const migratedPath = jsonPath + MIGRATED_SUFFIX
		if (existsSync(migratedPath)) {
			log.debug({ jsonPath }, "Legacy cache already migrated")
			continue
		}

		log.info({ jsonPath }, "Migrating legacy JSON cache to SQLite")

		let entries: Array<[string, GameCacheEntry]>
		try {
			const data = JSON.parse(readFileSync(jsonPath, "utf-8"))
			if (!Array.isArray(data)) {
				log.warn({ jsonPath }, "Invalid cache format, skipping migration")
				totalErrors++
				continue
			}
			entries = data
		} catch (err) {
			log.error({ err, jsonPath }, "Failed to parse legacy cache")
			totalErrors++
			continue
		}

		let migrated = 0
		let skipped = 0
		let errors = 0

		try {
			db.transaction(tx => {
				for (const [key, entry] of entries) {
					if (!key || !entry) {
						skipped++
						continue
					}

					try {
						const mediaUrls: Record<string, string> = {}
						if (entry.media?.boxFront?.url)
							mediaUrls["boxFront"] = entry.media.boxFront.url
						if (entry.media?.boxBack?.url)
							mediaUrls["boxBack"] = entry.media.boxBack.url
						if (entry.media?.screenshot?.url)
							mediaUrls["screenshot"] = entry.media.screenshot.url
						if (entry.media?.video?.url)
							mediaUrls["video"] = entry.media.video.url

						tx.insert(scraperCache)
							.values({
								cacheKey: key,
								gameId: entry.id ? parseInt(entry.id, 10) : null,
								gameName: entry.name || null,
								mediaUrls,
								rawResponse: entry as unknown as Record<string, unknown>,
								scrapedAt: entry.timestamp
									? new Date(entry.timestamp).toISOString()
									: now,
								expiresAt,
							})
							.onConflictDoNothing()
							.run()

						migrated++
					} catch (err) {
						log.warn({ err, key }, "Failed to migrate cache entry")
						errors++
					}
				}
			})
		} catch (err) {
			log.error({ err, jsonPath }, "Transaction failed during migration")
			totalErrors += entries.length
			continue
		}

		try {
			renameSync(jsonPath, migratedPath)
			log.info(
				{ migrated, skipped, errors, migratedPath },
				"Legacy cache migration complete",
			)
		} catch (err) {
			log.warn({ err, jsonPath }, "Failed to rename legacy cache file")
		}

		totalMigrated += migrated
		totalSkipped += skipped
		totalErrors += errors
	}

	return { migrated: totalMigrated, skipped: totalSkipped, errors: totalErrors }
}

/**
 * Calculate cache expiry date (30 days from now).
 */
function calculateExpiry(now: string): string {
	const date = new Date(now)
	date.setDate(date.getDate() + 30)
	return date.toISOString()
}
