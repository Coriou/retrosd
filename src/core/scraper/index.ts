/**
 * Core Scraper Engine
 *
 * Pure business logic for artwork scraping using async generators.
 * Emits events that UI components can consume without direct UI coupling.
 *
 * Key features:
 * - Lane-based rate limiting for ScreenScraper API
 * - Game cache for deduplicating lookups
 * - Per-ROM event emission for fine-grained UI updates
 * - Media download with validation
 */

import { readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import pLimit from "p-limit"

import { loadMetadata } from "../../metadata.js"
import { hashFile } from "../../hash.js"
import type { ScrapeEvent, ScraperOptions } from "../types.js"

import { LaneRateLimiter } from "./rate-limiter.js"
import { GameCache } from "./cache.js"
import {
	searchScreenScraper,
	validateCredentials,
	resolveDevCredentials,
	isDevCredentialError,
} from "./api.js"
import { downloadMediaForGame } from "./media.js"
import {
	SCREENSCRAPER_SYSTEMS,
	isRomFilename,
	type ScreenScraperGame,
	type GameCacheEntry,
} from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Main Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async generator that yields scrape events.
 *
 * Usage:
 * ```ts
 * for await (const event of scrapeArtwork(options)) {
 *   switch (event.type) {
 *     case 'scan': updateScanCount(event); break;
 *     case 'lookup': updateLookupStatus(event); break;
 *     case 'download': updateDownloadStatus(event); break;
 *     case 'complete': markComplete(event); break;
 *   }
 * }
 * ```
 */
export async function* scrapeArtwork(
	options: ScraperOptions,
): AsyncGenerator<ScrapeEvent> {
	for (const { path, system } of options.systemDirs) {
		yield* scrapeSystem(path, system, options)
	}
}

/**
 * Generator for scraping a single system directory
 */
async function* scrapeSystem(
	systemDir: string,
	system: string,
	options: ScraperOptions,
): AsyncGenerator<ScrapeEvent> {
	const systemId = SCREENSCRAPER_SYSTEMS[system]
	if (!systemId) {
		yield {
			type: "error",
			romFilename: "",
			system,
			error: `System ${system} not supported by ScreenScraper`,
		}
		return
	}

	// Check dev credentials
	const devCreds = resolveDevCredentials({
		devId: options.devId,
		devPassword: options.devPassword,
	})

	if (!devCreds.devId || !devCreds.devPassword) {
		yield {
			type: "error",
			romFilename: "",
			system,
			error:
				"ScreenScraper developer credentials required. Set SCREENSCRAPER_DEV_ID/SCREENSCRAPER_DEV_PASSWORD or pass --dev-id/--dev-password.",
		}
		return
	}

	// Scan for ROMs
	const mediaDir = join(systemDir, "media")
	let files: string[]
	try {
		files = readdirSync(systemDir)
	} catch (err) {
		yield {
			type: "error",
			romFilename: "",
			system,
			error: `Failed to scan directory: ${err instanceof Error ? err.message : String(err)}`,
		}
		return
	}

	const includeUnknown = options.includeUnknown === true
	const isBiosLike = (filename: string): boolean => {
		// Common conventions used in curated ROM sets
		return /^\[bios\]/i.test(filename) || /^\(bios\)/i.test(filename)
	}

	const romFiles = files
		.filter(f => isRomFilename(f, system, includeUnknown))
		.filter(f => !isBiosLike(f))

	yield {
		type: "scan",
		system,
		romsFound: romFiles.length,
	}

	if (romFiles.length === 0) {
		yield {
			type: "batch-complete",
			system,
			total: 0,
			success: 0,
			failed: 0,
			skipped: 0,
			durationMs: 0,
		}
		return
	}

	// Pre-filter to skip ROMs with existing media
	const wantsBox = options.boxArt !== false
	const wantsSS = options.screenshot === true
	const wantsVideo = options.video === true
	const wantsAny = wantsBox || wantsSS || wantsVideo

	const romsToScrape: string[] = []
	let skipped = 0

	for (const filename of romFiles) {
		if (!options.overwrite && wantsAny) {
			const baseName = filename.replace(/\.[^.]+$/, "")
			const hasAllMedia = checkExistingMedia(
				mediaDir,
				baseName,
				wantsBox,
				wantsSS,
				wantsVideo,
			)
			if (hasAllMedia) {
				skipped++
				continue
			}
		}
		romsToScrape.push(filename)
	}

	yield {
		type: "batch-start",
		system,
		total: romsToScrape.length,
	}

	const startTime = Date.now()

	// Initialize cache and rate limiter
	const cacheFile = join(systemDir, ".screenscraper-cache.json")
	const cache = new GameCache(cacheFile)

	const lanes = Math.max(1, Math.floor(options.concurrency ?? 1))
	const apiLimiter = new LaneRateLimiter(lanes, 1200) // 1.2s per thread

	const downloadConcurrency = Math.max(
		1,
		Math.min(lanes, Math.floor(options.downloadConcurrency ?? lanes)),
	)
	const lookupLimit = pLimit(lanes)

	// Track results
	let success = 0
	let failed = 0
	let devCredentialError: string | null = null
	let emittedDevCredentialError = false

	// Event queue for concurrent operations
	const eventQueue: ScrapeEvent[] = []
	let resolveQueue: (() => void) | null = null

	const pushEvent = (event: ScrapeEvent) => {
		eventQueue.push(event)
		if (resolveQueue) {
			resolveQueue()
			resolveQueue = null
		}
	}

	// Create lookup tasks
	const lookupTasks = romsToScrape.map(filename =>
		lookupLimit(async () => {
			if (devCredentialError) {
				skipped++
				return
			}

			const romPath = join(systemDir, filename)
			const baseName = filename.replace(/\.[^.]+$/, "")

			// Load metadata for hashes
			const metadata = loadMetadata(systemDir, filename)
			const hasHashes = Boolean(metadata?.hash?.crc32 || metadata?.hash?.sha1)

			// Build cache key
			const cacheKey = GameCache.makeKey(
				systemId,
				metadata?.hash?.sha1,
				metadata?.hash?.crc32,
				baseName,
				metadata?.hash?.size,
			)

			// Check cache
			let game: ScreenScraperGame | undefined = cacheKey
				? cache.get(cacheKey)
				: undefined

			if (!game) {
				// Get file size for API lookup
				const romSize = metadata?.hash?.size ?? statSync(romPath).size

				let result = await searchScreenScraper(
					systemId,
					filename,
					system,
					romSize,
					{
						username: options.username,
						password: options.password,
						devId: options.devId,
						devPassword: options.devPassword,
						crc32: metadata?.hash?.crc32,
						sha1: metadata?.hash?.sha1,
						verbose: options.verbose,
					},
					apiLimiter,
				)

				// If ScreenScraper can't match by name/size, retry once with hashes.
				if (!result.game && !hasHashes && result.error) {
					const looksLikeNoMatch = /rom\s*\/\s*iso\s*\/\s*dossier/i.test(
						result.error,
					)
					if (looksLikeNoMatch) {
						try {
							const fileHash = await hashFile(romPath)
							result = await searchScreenScraper(
								systemId,
								filename,
								system,
								fileHash.size,
								{
									username: options.username,
									password: options.password,
									devId: options.devId,
									devPassword: options.devPassword,
									crc32: fileHash.crc32,
									sha1: fileHash.sha1,
									verbose: options.verbose,
								},
								apiLimiter,
							)
						} catch {
							// If hashing fails, keep the original result.
						}
					}
				}

				if (!result.game) {
					if (result.error && isDevCredentialError(result.error)) {
						devCredentialError = result.error
						if (!emittedDevCredentialError) {
							emittedDevCredentialError = true
							pushEvent({
								type: "error",
								romFilename: "",
								system,
								error: result.error,
							})
						}
						failed++
						return
					}

					pushEvent({
						type: "lookup",
						romFilename: filename,
						system,
						found: false,
					})

					pushEvent({
						type: "error",
						romFilename: filename,
						system,
						error: result.error || "Game not found on ScreenScraper",
					})

					failed++
					return
				}

				game = result.game
				if (cacheKey) {
					cache.set(cacheKey, {
						...game,
						timestamp: Date.now(),
					})
				}
			}

			// Emit lookup success
			pushEvent({
				type: "lookup",
				romFilename: filename,
				system,
				gameTitle: game.name,
				found: true,
			})

			// Download media
			const mediaResult = await downloadMediaForGame(
				game,
				baseName,
				mediaDir,
				{
					boxArt: options.boxArt,
					screenshot: options.screenshot,
					video: options.video,
					overwrite: options.overwrite,
					verbose: options.verbose,
					username: options.username,
					password: options.password,
					devId: options.devId,
					devPassword: options.devPassword,
				},
				// onMediaStart
				mediaType => {
					pushEvent({
						type: "download",
						romFilename: filename,
						system,
						gameTitle: game!.name,
						mediaType,
						status: "start",
					})
				},
				// onMediaComplete
				(mediaType, result) => {
					pushEvent({
						type: "download",
						romFilename: filename,
						system,
						gameTitle: game!.name,
						mediaType,
						status: result.ok ? "complete" : "error",
						...(result.ok ? {} : { error: result.error ?? "Download failed" }),
					})
				},
			)

			// Emit completion
			const ok = !wantsAny || mediaResult.hadAny
			if (ok) {
				if (mediaResult.downloadedAny) {
					success++
				} else {
					skipped++
				}

				pushEvent({
					type: "complete",
					romFilename: filename,
					system,
					gameTitle: game.name,
					mediaDownloaded: mediaResult.media,
				})
			} else {
				failed++
				pushEvent({
					type: "error",
					romFilename: filename,
					system,
					error: "No requested media available",
				})
			}
		}),
	)

	// Wait for all lookups while yielding events
	const allDone = Promise.all(lookupTasks)
	let done = false
	void allDone.then(() => {
		done = true
		if (resolveQueue) resolveQueue()
	})

	while (!done || eventQueue.length > 0) {
		if (eventQueue.length > 0) {
			yield eventQueue.shift()!
		} else if (!done) {
			await new Promise<void>(resolve => {
				resolveQueue = resolve
			})
		}
	}

	// Flush cache
	cache.flush()

	const durationMs = Date.now() - startTime

	yield {
		type: "batch-complete",
		system,
		total: romFiles.length,
		success,
		failed,
		skipped,
		durationMs,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs"

/**
 * Check if all requested media already exists
 */
function checkExistingMedia(
	mediaDir: string,
	baseName: string,
	wantsBox: boolean,
	wantsSS: boolean,
	wantsVideo: boolean,
): boolean {
	// Check box art
	if (wantsBox) {
		const hasBox =
			existsSync(join(mediaDir, `${baseName}-box.png`)) ||
			existsSync(join(mediaDir, `${baseName}-box.jpg`))
		if (!hasBox) return false
	}

	// Check screenshot
	if (wantsSS) {
		const hasSS =
			existsSync(join(mediaDir, `${baseName}-screenshot.png`)) ||
			existsSync(join(mediaDir, `${baseName}-screenshot.jpg`))
		if (!hasSS) return false
	}

	// Check video
	if (wantsVideo) {
		const hasVideo =
			existsSync(join(mediaDir, `${baseName}-video.mp4`)) ||
			existsSync(join(mediaDir, `${baseName}-video.webm`))
		if (!hasVideo) return false
	}

	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────────────────────

export { validateCredentials } from "./api.js"
export { LaneRateLimiter } from "./rate-limiter.js"
export { GameCache } from "./cache.js"
export type { ScrapeEvent, ScraperOptions } from "../types.js"
