/**
 * tidy
 *
 * Orchestrator for maintenance command that keeps everything tidy by:
 * 1. Syncing remote catalogs and local ROM presence (sync-db)
 * 2. Generating missing metadata (optional)
 * 3. Scraping artwork (optional)
 *
 * Design:
 * - Safe defaults: DB refresh always runs; metadata/scraping off by default
 * - Avoids unnecessary SD card writes by default (metadata missing-only)
 * - Explicit opt-in for expensive operations (--metadata, --scrape)
 * - Best-effort by default; --strict mode exits on any failure
 */

import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { ui } from "../ui.js"
import type { SyncDbResult } from "./sync-db.js"
import type { ScraperOptions } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TidyOptions {
	/** Path to SD card root directory */
	targetDir: string
	/** Resolved path to the SQLite database */
	dbPath: string
	/** Systems to process (empty/undefined = all) */
	systems?: string[]
	/** Force full remote resync */
	force?: boolean
	/** Compress eligible ROMs (disc images -> CHD). */
	compress?: boolean
	/** When compressing, delete original disc files after successful conversion. */
	compressDeleteOriginals?: boolean
	/** Enable metadata generation stage */
	metadata?: boolean
	/** Metadata mode: missing (default), refresh */
	metadataMode?: "missing" | "refresh"
	/** Allow overwriting metadata sidecars when refreshing */
	overwriteMetadata?: boolean
	/** Generate SHA-1/CRC32 hashes when creating metadata */
	withHashes?: boolean
	/** Enable scraping stage */
	scrape?: boolean
	/** Scrape mode: missing (default), refresh */
	scrapeMode?: "missing" | "refresh"
	/** Media types to scrape: box, screenshot, video */
	scrapeMedia?: string[]
	/** ScreenScraper credentials */
	username?: string
	password?: string
	devId?: string
	devPassword?: string
	/** Suppress most output */
	quiet?: boolean
	/** Print per-system detail */
	verbose?: boolean
	/** Exit with code 1 if any stage fails */
	strict?: boolean
}

export interface TidyResult {
	/** Overall success status */
	ok: boolean
	/** Compression/conversion result */
	compress: {
		ok: boolean
		converted: number
		skipped: number
		failed: number
	} | null
	/** Database sync result */
	sync: SyncDbResult | null
	/** Metadata generation result */
	metadata: {
		ok: boolean
		created: number
		skipped: number
		failed: number
	} | null
	/** Scraping result */
	scrape: {
		ok: boolean
		failed: number
	} | null
	/** Total elapsed time in milliseconds */
	elapsedMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Implementation
// ─────────────────────────────────────────────────────────────────────────────

function nowMs(): number {
	return performance.now()
}

export async function runTidy(options: TidyOptions): Promise<TidyResult> {
	const start = nowMs()
	const quiet = Boolean(options.quiet)
	const verbose = Boolean(options.verbose)
	const strict = Boolean(options.strict)
	const stageQuiet = quiet || !verbose

	const result: TidyResult = {
		ok: true,
		compress: null,
		sync: null,
		metadata: null,
		scrape: null,
		elapsedMs: 0,
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Stage 0: Compression (optional, best-effort)
	// Runs before DB sync so the scan reflects the final file set.
	// ─────────────────────────────────────────────────────────────────────────

	if (options.compress === true) {
		const romsDir = join(options.targetDir, "Roms")
		const hasRomsDir = existsSync(romsDir)

		if (!hasRomsDir) {
			if (!quiet && verbose) {
				ui.warn("Compress: Roms directory not found; skipping")
			}
			result.compress = {
				ok: true,
				converted: 0,
				skipped: 0,
				failed: 0,
			}
		} else {
			try {
				const { convertRomsInDirectory } = await import("../convert.js")
				const systemsToProcess =
					options.systems && options.systems.length > 0
						? options.systems
						: readdirSync(romsDir).filter(item => {
								const itemPath = join(romsDir, item)
								try {
									return statSync(itemPath).isDirectory()
								} catch {
									return false
								}
							})

				let converted = 0
				let failed = 0
				let skipped = 0

				for (const system of systemsToProcess) {
					const systemDir = join(romsDir, system)
					if (!existsSync(systemDir)) continue

					const convertResult = await convertRomsInDirectory(systemDir, {
						deleteOriginals: options.compressDeleteOriginals === true,
						verbose,
						quiet: stageQuiet,
					})

					converted += convertResult.converted
					failed += convertResult.failed
					skipped += convertResult.skipped
				}

				result.compress = {
					ok: failed === 0,
					converted,
					skipped,
					failed,
				}

				if (!quiet) {
					ui.info(
						`Compress: ${converted} converted, ${skipped} skipped, ${failed} failed`,
					)
				}

				if (failed > 0 && strict) {
					result.ok = false
				}
			} catch (err) {
				result.compress = {
					ok: false,
					converted: 0,
					skipped: 0,
					failed: 0,
				}

				if (strict) {
					result.ok = false
				}

				const message = err instanceof Error ? err.message : String(err)
				if (!quiet) {
					ui.error(`Compress: failed: ${message}`)
				}

				if (strict) {
					const elapsedMs = Math.round(nowMs() - start)
					result.elapsedMs = elapsedMs
					return result
				}
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Stage 1: Database Sync (always runs; always required)
	// ─────────────────────────────────────────────────────────────────────────

	if (!quiet && verbose) {
		ui.header("Tidy")
	}

	const { runSyncDb } = await import("./sync-db.js")
	let syncResult: SyncDbResult

	try {
		syncResult = await runSyncDb({
			targetDir: options.targetDir,
			dbPath: options.dbPath,
			...(options.systems && options.systems.length > 0
				? { systems: options.systems }
				: {}),
			...(typeof options.force === "boolean" ? { force: options.force } : {}),
			quiet: stageQuiet,
			verbose,
		})

		result.sync = syncResult

		if (!syncResult.ok) {
			result.ok = false
			const elapsedMs = Math.round(nowMs() - start)
			result.elapsedMs = elapsedMs
			if (!quiet) {
				ui.error("DB sync failed; aborting")
			}
			return result
		}

		if (!quiet) {
			ui.info(
				`DB: ok (${syncResult.remote.totalRomsIndexed.toLocaleString()} indexed, ${syncResult.scan.romsFound.toLocaleString()} scanned)`,
			)
		}
	} catch (err) {
		result.ok = false
		const elapsedMs = Math.round(nowMs() - start)
		result.elapsedMs = elapsedMs
		const message = err instanceof Error ? err.message : String(err)
		if (!quiet) {
			ui.error(`DB: failed: ${message}`)
		}
		return result
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Stage 2: Metadata Generation (optional, best-effort)
	// ─────────────────────────────────────────────────────────────────────────

	if (options.metadata === true) {
		const romsDir = join(options.targetDir, "Roms")
		const hasRomsDir = existsSync(romsDir)

		if (!hasRomsDir) {
			if (!quiet && verbose) {
				ui.warn("Metadata: Roms directory not found; skipping")
			}
			result.metadata = {
				ok: true,
				created: 0,
				skipped: 0,
				failed: 0,
			}
		} else {
			try {
				const { generateMetadataForExisting } = await import("../metadata.js")
				const metadataMode = options.metadataMode ?? "missing"
				const overwrite =
					metadataMode === "refresh" && options.overwriteMetadata === true
				if (!quiet && metadataMode === "refresh" && !overwrite) {
					ui.info(
						"Metadata: refresh requested but --overwrite-metadata not set; treating as missing-only",
					)
				}

				const metaResult = await generateMetadataForExisting(romsDir, {
					...(options.systems && options.systems.length > 0
						? { systems: options.systems }
						: {}),
					withHashes: options.withHashes === true,
					overwrite,
					verbose: options.verbose === true,
					quiet: stageQuiet,
				})

				result.metadata = {
					ok: true,
					created: metaResult.created,
					skipped: metaResult.skipped,
					failed: metaResult.failed,
				}

				if (!quiet) {
					ui.info(
						`Metadata: ${metaResult.created} created, ${metaResult.skipped} skipped, ${metaResult.failed} failed`,
					)
				}

				if (metaResult.failed > 0 && strict) {
					result.ok = false
				}
			} catch (err) {
				result.metadata = {
					ok: false,
					created: 0,
					skipped: 0,
					failed: 0,
				}

				if (strict) {
					result.ok = false
				}

				const message = err instanceof Error ? err.message : String(err)
				if (!quiet) {
					ui.error(`Metadata: failed: ${message}`)
				}

				if (strict) {
					const elapsedMs = Math.round(nowMs() - start)
					result.elapsedMs = elapsedMs
					return result
				}
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Stage 3: Scraping (optional, best-effort)
	// ─────────────────────────────────────────────────────────────────────────

	if (options.scrape === true) {
		const romsDir = join(options.targetDir, "Roms")
		const hasRomsDir = existsSync(romsDir)

		if (!hasRomsDir) {
			if (!quiet && verbose) {
				ui.warn("Scrape: Roms directory not found; skipping")
			}
			result.scrape = {
				ok: true,
				failed: 0,
			}
		} else {
			try {
				const scraperOptions = buildScraperOptions({
					romsDir,
					dbPath: options.dbPath,
					systems: options.systems,
					scrapeMode: options.scrapeMode,
					scrapeMedia: options.scrapeMedia,
					username: options.username,
					password: options.password,
					devId: options.devId,
					devPassword: options.devPassword,
					verbose,
				})

				const scrapeResult = await runScrapePlain(scraperOptions, {
					quiet: stageQuiet,
				})

				result.scrape = {
					ok: scrapeResult.failed === 0,
					failed: scrapeResult.failed,
				}

				if (!quiet) {
					ui.info(`Scrape: ${scrapeResult.failed} failed`)
				}

				if (scrapeResult.failed > 0 && strict) {
					result.ok = false
				}
			} catch (err) {
				result.scrape = {
					ok: false,
					failed: 0,
				}

				if (strict) {
					result.ok = false
				}

				const message = err instanceof Error ? err.message : String(err)
				if (!quiet) {
					ui.error(`Scrape: failed: ${message}`)
				}

				if (strict) {
					const elapsedMs = Math.round(nowMs() - start)
					result.elapsedMs = elapsedMs
					return result
				}
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Done
	// ─────────────────────────────────────────────────────────────────────────

	const elapsedMs = Math.round(nowMs() - start)
	result.elapsedMs = elapsedMs

	if (!quiet && verbose) {
		ui.success(`Tidy complete in ${(elapsedMs / 1000).toFixed(1)}s`)
	}

	return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildScraperOptions(options: {
	romsDir: string
	dbPath: string
	systems: string[] | undefined
	scrapeMode: "missing" | "refresh" | undefined
	scrapeMedia: string[] | undefined
	username: string | undefined
	password: string | undefined
	devId: string | undefined
	devPassword: string | undefined
	verbose: boolean
}): ScraperOptions {
	const systemDirs: Array<{ path: string; system: string }> = []
	const systemFilter =
		options.systems && options.systems.length > 0
			? new Set(
					options.systems.map(s => s.trim().toUpperCase()).filter(Boolean),
				)
			: null

	try {
		const allItems = readdirSync(options.romsDir)
		for (const item of allItems) {
			const itemPath = join(options.romsDir, item)
			const stat = statSync(itemPath)
			if (!stat.isDirectory()) continue
			if (systemFilter && !systemFilter.has(item.toUpperCase())) continue
			systemDirs.push({ path: itemPath, system: item })
		}
	} catch {
		// best-effort; continue with empty list
	}

	const mediaList = options.scrapeMedia ?? ["box"]

	return {
		systemDirs,
		dbPath: options.dbPath,
		boxArt: mediaList.includes("box"),
		screenshot: mediaList.includes("screenshot"),
		video: mediaList.includes("video"),
		...(options.username ? { username: options.username } : {}),
		...(options.password ? { password: options.password } : {}),
		...(options.devId ? { devId: options.devId } : {}),
		...(options.devPassword ? { devPassword: options.devPassword } : {}),
		verbose: options.verbose,
		overwrite: options.scrapeMode === "refresh",
	}
}

async function runScrapePlain(
	scraperOptions: ScraperOptions,
	options: { quiet: boolean },
): Promise<{ failed: number }> {
	const { scrapeArtwork } = await import("./scraper/index.js")

	const quiet = options.quiet

	const systemFailures = new Set<string>()
	const systemCompleted = new Map<
		string,
		{ success: number; failed: number; skipped: number }
	>()

	for await (const event of scrapeArtwork(scraperOptions)) {
		switch (event.type) {
			case "scan": {
				if (!quiet) {
					ui.info(`${event.system}: found ${event.romsFound} ROMs`)
				}
				break
			}
			case "batch-start": {
				if (!quiet) {
					ui.info(`${event.system}: scraping ${event.total} ROMs`)
				}
				break
			}
			case "lookup": {
				// Suppress per-ROM lookup details in tidy
				break
			}
			case "download": {
				if (!quiet && event.status === "error") {
					ui.warn(
						`${event.system}: ${event.romFilename} (${event.mediaType}) failed: ${event.error ?? "unknown error"}`,
					)
				}
				break
			}
			case "complete": {
				// Suppress per-ROM completion details in tidy
				break
			}
			case "error": {
				// System-level errors (unsupported system, missing credentials, etc.)
				if (!event.romFilename) {
					if (!systemFailures.has(event.system)) {
						systemFailures.add(event.system)
					}
					ui.error(`${event.system}: ${event.error}`)
					break
				}

				ui.error(`${event.system}: ${event.romFilename} failed: ${event.error}`)
				break
			}
			case "batch-complete": {
				systemCompleted.set(event.system, {
					success: event.success,
					failed: event.failed,
					skipped: event.skipped,
				})
				if (!quiet) {
					ui.info(
						`${event.system}: ${event.success} scraped, ${event.skipped} skipped, ${event.failed} failed`,
					)
				}
				break
			}
		}
	}

	let failed = 0
	for (const summary of systemCompleted.values()) {
		failed += summary.failed
	}
	failed += systemFailures.size

	return { failed }
}
