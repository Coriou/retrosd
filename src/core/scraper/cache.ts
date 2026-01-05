/**
 * Game cache for ScreenScraper lookups
 *
 * Persists game data to disk to avoid redundant API calls.
 * Features auto-save every N writes for crash resilience.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import type { GameCacheEntry } from "./types.js"

/** Auto-save threshold - save after this many pending writes */
const AUTO_SAVE_THRESHOLD = 10

/** Minimum interval between saves (ms) */
const MIN_SAVE_INTERVAL = 5000

export class GameCache {
	private cache = new Map<string, GameCacheEntry>()
	private cacheFile: string
	private dirty = false
	private pendingWrites = 0
	private lastSaveAt = 0

	constructor(cacheFile: string) {
		this.cacheFile = cacheFile
		this.load()
	}

	/**
	 * Load cache from disk
	 */
	load(): void {
		if (!existsSync(this.cacheFile)) return

		try {
			const data = JSON.parse(readFileSync(this.cacheFile, "utf-8"))
			if (Array.isArray(data)) {
				for (const [key, entry] of data) {
					if (typeof key === "string" && entry) {
						this.cache.set(key, entry)
					}
				}
			}
		} catch {
			// Cache corrupted or invalid, start fresh
		}
	}

	/**
	 * Save cache to disk
	 */
	save(): void {
		try {
			const entries = Array.from(this.cache.entries())
			writeFileSync(this.cacheFile, JSON.stringify(entries, null, 2))
			this.dirty = false
			this.pendingWrites = 0
			this.lastSaveAt = Date.now()
		} catch {
			// Ignore save errors, cache is non-critical
		}
	}

	/**
	 * Conditionally save if threshold reached
	 */
	private maybeSave(): void {
		if (this.pendingWrites >= AUTO_SAVE_THRESHOLD) {
			const elapsed = Date.now() - this.lastSaveAt
			if (elapsed >= MIN_SAVE_INTERVAL) {
				this.save()
			}
		}
	}

	/**
	 * Get a cached entry
	 */
	get(key: string): GameCacheEntry | undefined {
		return this.cache.get(key)
	}

	/**
	 * Set a cache entry
	 */
	set(key: string, entry: GameCacheEntry): void {
		if (!key) return
		this.cache.set(key, entry)
		this.dirty = true
		this.pendingWrites++
		this.maybeSave()
	}

	/**
	 * Force save if dirty
	 */
	flush(): void {
		if (this.dirty) {
			this.save()
		}
	}

	/**
	 * Generate a cache key from ROM identifiers
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

	/**
	 * Get the number of cached entries
	 */
	get size(): number {
		return this.cache.size
	}
}
