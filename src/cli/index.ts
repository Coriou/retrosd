#!/usr/bin/env node
/**
 * RetroSD CLI - Retro SD Card Creator
 * State-of-the-art BIOS & ROM downloader for retro gaming consoles
 * Enhanced with DAT-style verification, metadata generation, and library management
 */

import "../bootstrap.js"
import { existsSync } from "node:fs"
import { join, isAbsolute, resolve } from "node:path"
import { Command } from "commander"
import { loadConfig } from "../config.js"
import { ui } from "../ui.js"
import { downloadBios } from "../bios.js"
import {
	downloadRoms,
	createRomDirectories,
	getEntriesBySources,
	getEntriesByKeys,
} from "../roms.js"
import { loadFilterList, parsePatternList } from "../filters.js"
import { normalizeLanguageCode, normalizeRegionCode } from "../romname.js"
import {
	promptConfirmRomDownload,
	promptConfirmBiosDownload,
	promptSources,
	promptSystems,
	promptFilter,
	promptOneG1RProfile,
	promptScrapeOptions,
	promptMetadataOptions,
	setupPromptHandlers,
} from "../prompts.js"
import { loadPreferences, updatePreferences } from "../preferences.js"
import type { UserPreferences } from "../preferences.js"
import {
	scanCollection,
	verifyCollection,
	exportManifest,
} from "../collection.js"
import { computeScanStats } from "../scan/stats.js"
import { convertRomsInDirectory } from "../convert.js"
import type {
	Source,
	RomEntry,
	RegionPreset,
	DownloadResult,
	DiskProfile,
} from "../types.js"
// Ink UI render functions
import {
	renderDownload,
	renderScrape,
	runScanView,
	runVerifyView,
	runConvertView,
} from "../ui/renderApp.js"
import type { ScraperOptions } from "../core/types.js"
import { generateMetadataForExisting } from "../metadata.js"
import { flushLogs } from "../logger.js"

function resolveDbPathForTarget(targetDir: string, dbPath?: string): string {
	if (!dbPath) return join(targetDir, ".retrosd.db")
	if (dbPath === ":memory:") return dbPath
	if (isAbsolute(dbPath)) return dbPath
	return resolve(targetDir, dbPath)
}

async function exitWithCode(code: number): Promise<void> {
	if (code === 0) return
	try {
		await flushLogs()
	} catch {
		// Best-effort; never block exiting on log flush failures
	}
	process.exitCode = code
}

async function runScrapePlain(
	scraperOptions: ScraperOptions,
	options: { quiet: boolean },
): Promise<{ failed: number }> {
	const { scrapeArtwork } = await import("../core/scraper/index.js")

	const quiet = options.quiet
	const verbose = Boolean(scraperOptions.verbose)

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
				if (!quiet && verbose && !event.found) {
					ui.warn(`${event.system}: no match for ${event.romFilename}`)
				}
				break
			}
			case "download": {
				if (event.status === "error") {
					ui.warn(
						`${event.system}: ${event.romFilename} (${event.mediaType}) failed: ${event.error ?? "unknown error"}`,
					)
				} else if (!quiet && verbose) {
					ui.info(
						`${event.system}: ${event.romFilename} (${event.mediaType}) ${event.status}`,
					)
				}
				break
			}
			case "complete": {
				if (!quiet && verbose) {
					ui.success(`${event.system}: ${event.romFilename} complete`)
				}
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

const VERSION = "2.0.0"

// ─────────────────────────────────────────────────────────────────────────────
// CLI Definition
// ─────────────────────────────────────────────────────────────────────────────

const program = new Command()

// Allow options after positional arguments (better ergonomics for automation scripts).
program.enablePositionalOptions()

program
	.name("retrosd")
	.version(VERSION)
	.description(
		"Retro SD Card Creator – BIOS & ROM downloader for retro gaming consoles",
	)
	.argument("<target>", "Path to SD card root directory")
	.option(
		"--db-path <path>",
		"Custom SQLite database path (default: <target>/.retrosd.db; relative paths resolved from <target>)",
	)
	.option("-n, --dry-run", "Preview actions without downloading", false)
	.option("-j, --jobs <number>", "Number of parallel downloads", "4")
	.option("--bios-only", "Only download BIOS files", false)
	.option("--roms-only", "Only download ROMs (skip BIOS)", false)
	.option("--ink", "Use Ink React UI for progress display", false)
	.option(
		"--preset <name>",
		"Filter preset: usa, english, ntsc, pal, japanese, all",
	)
	.option("-f, --filter <regex>", "Custom filter pattern")
	.option("--sources <list>", "Comma-separated sources: no-intro,redump")
	.option("--systems <list>", "Comma-separated system keys: GB,GBA,MD,etc.")
	.option("--resume", "Resume interrupted downloads", false)
	.option("--non-interactive", "No prompts (for automation)", false)
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.option("--include-prerelease", "Include beta/demo/proto ROMs")
	.option("--include-unlicensed", "Include unlicensed/pirate ROMs")
	.option("--include-hacks", "Include hacked ROMs")
	.option("--include-homebrew", "Include homebrew ROMs")
	.option(
		"--include-pattern <patterns>",
		"Only include ROMs matching patterns (comma-separated, * wildcards)",
	)
	.option(
		"--exclude-pattern <patterns>",
		"Exclude ROMs matching patterns (comma-separated, * wildcards)",
	)
	.option(
		"--include-from <file>",
		"Only include ROMs listed in file (one per line)",
	)
	.option("--exclude-from <file>", "Exclude ROMs listed in file (one per line)")
	.option("--region <code>", "Prefer region for 1G1R (eu, us, jp, etc.)")
	.option(
		"--region-priority <list>",
		"Override region priority list for 1G1R (comma-separated)",
	)
	.option("--lang <code>", "Prefer language for 1G1R (en, fr, etc.)")
	.option(
		"--lang-scope <mode>",
		"How to apply --lang: prefer (default), strict (only that lang), fallback (lang then en)",
	)
	.option(
		"--no-lang-infer",
		"Disable language inference when ROM filenames lack language tags",
	)
	.option(
		"--lang-priority <list>",
		"Override language priority list for 1G1R (comma-separated)",
	)
	.option("--update", "Revalidate remote ROMs and redownload if changed", false)
	.option(
		"--disk-profile <profile>",
		"Disk speed profile: fast (SSD), balanced (HDD), slow (SD card/NAS)",
		"balanced",
	)
	.option("--no-1g1r", "Disable 1G1R (one-game-one-ROM) filtering")
	.option("--no-metadata", "Skip metadata generation")
	.option("--verify-hashes", "Generate and verify SHA-1/CRC32 hashes", false)
	.option("--convert-chd", "Convert disc images to CHD format", false)
	.option("--scrape", "Scrape artwork after download", false)
	.option("--username <user>", "ScreenScraper username")
	.option("--password <pass>", "ScreenScraper password")
	.option("--dev-id <id>", "ScreenScraper developer ID")
	.option("--dev-password <pass>", "ScreenScraper developer password")
	.option(
		"--scrape-media <list>",
		"Media to scrape: box,screenshot,video",
		"box",
	)
	.action(run)

// Add ui-test command for verifying Ink installation
program
	.command("ui-test")
	.description("Test the Ink UI components (development)")
	.action(async () => {
		const { runUiTest } = await import("../ui/views/UiTest.js")
		runUiTest()
	})

// Add sync command
program
	.command("sync")
	.description("Sync remote ROM catalogs to local database for fast search")
	.argument("<target>", "Path to SD card root directory (database stored here)")
	.option("--systems <list>", "Comma-separated system keys (default: all)")
	.option("--force", "Force full resync, ignoring timestamps", false)
	.option("-q, --quiet", "Minimal output", false)
	.option("--ink", "Use Ink React UI for progress display", false)
	.action(async (target, options, command) => {
		setupPromptHandlers()
		const parentOptions = command.parent?.opts?.() ?? {}

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const dbPath = resolveDbPathForTarget(
			target,
			(parentOptions.dbPath as string | undefined) ?? undefined,
		)
		const systems = options.systems
			? options.systems.split(",").map((s: string) => s.trim())
			: undefined

		const isInteractiveTty = Boolean(process.stdout.isTTY)
		const useInk = Boolean(options.ink || (isInteractiveTty && !options.quiet))

		const syncOptions = {
			dbPath,
			systems,
			force: options.force,
		}

		if (useInk) {
			const { runSyncView } = await import("../ui/renderApp.js")
			const exitCode = await runSyncView(syncOptions)
			if (exitCode !== 0) await exitWithCode(exitCode)
			return
		}

		// Plain-text fallback (no Ink)
		const { syncCatalog } = await import("../core/catalog-sync.js")

		ui.header("Syncing Catalogs to Local Database")
		if (!options.quiet) {
			ui.info(`Database: ${dbPath}`)
			if (systems) {
				ui.info(`Systems: ${systems.join(", ")}`)
			} else {
				ui.info("Systems: all")
			}
		}

		let totalRoms = 0
		let errors = 0

		for await (const event of syncCatalog(syncOptions)) {
			switch (event.type) {
				case "sync:start":
					if (!options.quiet) {
						ui.info(`Starting sync for ${event.totalSystems} systems`)
					}
					break
				case "system:start":
					if (!options.quiet) {
						ui.info(`${event.system}: fetching ${event.label}…`)
					}
					break
				case "system:complete":
					if (!options.quiet) {
						ui.success(
							`${event.system}: ${event.romCount.toLocaleString()} ROMs indexed in ${(event.durationMs / 1000).toFixed(1)}s`,
						)
					}
					totalRoms += event.romCount
					break
				case "system:skip":
					if (!options.quiet) {
						ui.info(`${event.system}: ${event.reason}`)
					}
					break
				case "system:error":
					ui.error(`${event.system}: ${event.error}`)
					errors++
					break
				case "sync:complete":
					ui.success(
						`Sync complete: ${totalRoms.toLocaleString()} ROMs indexed across ${event.totalSystems} systems`,
					)
					break
			}
		}

		if (errors > 0) {
			process.exit(1)
		}
	})

// Add sync-db command (fast periodic DB refresh: remote + local)
program
	.command("sync-db")
	.description(
		"Sync remote catalogs and local ROM presence into the database (optimized for periodic runs)",
	)
	.argument("<target>", "Path to SD card root directory (database stored here)")
	.option("--systems <list>", "Comma-separated system keys (default: all)")
	.option("--force", "Force full resync, ignoring timestamps", false)
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "More detailed output", false)
	.action(async (target, options, command) => {
		setupPromptHandlers()
		const parentOptions = command.parent?.opts?.() ?? {}

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const dbPath = resolveDbPathForTarget(
			target,
			(parentOptions.dbPath as string | undefined) ?? undefined,
		)
		const systems = options.systems
			? options.systems.split(",").map((s: string) => s.trim())
			: undefined
		const quiet = Boolean(options.quiet || parentOptions.quiet)
		const verbose = Boolean(options.verbose || parentOptions.verbose)

		const { runSyncDb } = await import("../core/sync-db.js")
		const result = await runSyncDb({
			targetDir: target,
			dbPath,
			systems,
			force: options.force,
			quiet,
			verbose,
		})

		if (!result.ok) {
			await exitWithCode(1)
		}
	})

// Add search command
program
	.command("search")
	.description("Search the local ROM catalog (synced database)")
	.argument("<target>", "Path to SD card root directory (database location)")
	.argument("[query]", "Search query (matches title or filename)")
	.option("--systems <list>", "Comma-separated system filters (e.g., GB,GBA)")
	.option(
		"--regions <list>",
		"Comma-separated region filters (e.g., USA,Europe)",
	)
	.option("--local", "Only show locally downloaded ROMs", false)
	.option("--include-prerelease", "Include beta/demo/proto ROMs", false)
	.option("-n, --limit <number>", "Results per page", "25")
	.option("-i, --interactive", "Interactive mode (Ink UI)", false)
	.option("-q, --quiet", "Minimal output", false)
	.action(async (target, query, options, command) => {
		setupPromptHandlers()
		const parentOptions = command.parent?.opts?.() ?? {}

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const dbPathOverride =
			(parentOptions.dbPath as string | undefined) ?? undefined
		const dbPath = resolveDbPathForTarget(target, dbPathOverride)
		if (!existsSync(dbPath)) {
			ui.error(`Database not found: ${dbPath}`)
			ui.info(
				dbPathOverride
					? `Run 'retrosd sync ${target} --db-path ${dbPathOverride}' first to sync the catalog.`
					: `Run 'retrosd sync ${target}' first to sync the catalog.`,
			)
			process.exit(1)
		}

		const systems = options.systems
			? options.systems.split(",").map((s: string) => s.trim())
			: undefined
		const regions = options.regions
			? options.regions.split(",").map((r: string) => r.trim())
			: undefined

		const isInteractiveTty = Boolean(process.stdout.isTTY)
		const useInk = Boolean(
			options.interactive || (isInteractiveTty && !options.quiet),
		)

		const searchOpts = {
			dbPath,
			targetDir: target,
			query: query ?? "",
			systems,
			regions,
			localOnly: options.local,
			excludePrerelease: !options.includePrerelease,
			limit: parseInt(options.limit, 10) || 25,
		}

		if (useInk) {
			const { runSearchView } = await import("../ui/renderApp.js")
			const result = await runSearchView(searchOpts)
			if (result?.failed) await exitWithCode(1)
			return
		}

		// Plain-text output (non-interactive)
		const { getDb } = await import("../db/index.js")
		const { searchRoms, countSearchResults, getCatalogStats } =
			await import("../db/queries/search.js")

		const db = getDb(dbPath)
		const stats = getCatalogStats(db)

		if (stats.totalRoms === 0) {
			ui.warn(
				"Catalog is empty. Run 'retrosd sync' first to populate the database.",
			)
			process.exit(0)
		}

		if (!query && !systems && !regions && !options.local) {
			// No filters - show catalog summary
			ui.header("ROM Catalog")
			ui.info(`Total ROMs: ${stats.totalRoms.toLocaleString()}`)
			ui.info(`Systems: ${stats.systemCount}`)
			ui.info(`Downloaded: ${stats.localRoms.toLocaleString()}`)
			ui.info("")
			ui.info("Per-system breakdown:")
			for (const s of stats.systemStats.slice(0, 15)) {
				const localLabel = s.localCount > 0 ? ` (${s.localCount} local)` : ""
				ui.info(`  ${s.system}: ${s.count.toLocaleString()}${localLabel}`)
			}
			if (stats.systemStats.length > 15) {
				ui.info(`  ... and ${stats.systemStats.length - 15} more systems`)
			}
			ui.info("")
			ui.info(
				"Use 'retrosd search <target> <query>' to search, or -i for interactive mode.",
			)
			return
		}

		const results = searchRoms(db, searchOpts)
		const totalCount = countSearchResults(db, searchOpts)

		if (!options.quiet) {
			ui.header(`Search Results: "${query || "(all)}"}"`)
			ui.info(`Found ${totalCount} matching ROMs`)
		}

		if (results.length === 0) {
			ui.warn("No ROMs match your query.")
			process.exit(0)
		}

		// Table-style output
		for (const rom of results) {
			const localMark = rom.isLocal ? "✓" : " "
			const regions = rom.regions?.slice(0, 2).join(",") ?? ""
			const title = rom.title ?? rom.filename
			const display = title.length > 50 ? title.slice(0, 49) + "…" : title
			ui.info(
				`[${localMark}] ${rom.system.padEnd(5)} ${display.padEnd(52)} ${regions}`,
			)
		}

		if (totalCount > results.length) {
			ui.info(
				`\n... and ${totalCount - results.length} more results. Use -i for interactive browsing.`,
			)
		}
	})

// Add scan command
program
	.command("scan")
	.description("Scan and catalog installed ROMs")
	.argument("<target>", "Path to SD card root directory")
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.option("--hashes", "Compute SHA-1/CRC32 hashes (slower)", false)
	.option("-o, --output <file>", "Export manifest to JSON file")
	.option("--ink", "Use Ink React UI for progress display", false)
	.action(async (target, options, command) => {
		setupPromptHandlers()
		const parentOptions = command.parent?.opts?.() ?? {}

		function inferCatalogSystemKey(
			systemDir: string,
			localFilename: string,
		): string {
			if (systemDir === "FC") {
				const ext = localFilename
					.slice(localFilename.lastIndexOf("."))
					.toLowerCase()
				return ext === ".fds" ? "FC_FDS" : "FC_CART"
			}

			const map: Record<string, string> = {
				GB: "GB",
				GBA: "GBA",
				GBC: "GBC",
				MD: "MD",
				PCE: "PCE",
				PKM: "PKM",
				SGB: "SGB",
				PS: "PS",
			}

			return map[systemDir] ?? systemDir
		}

		function inferCatalogFilename(localFilename: string): string {
			const dot = localFilename.lastIndexOf(".")
			const base = dot > 0 ? localFilename.slice(0, dot) : localFilename
			return `${base}.zip`
		}

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
		const dbPath = resolveDbPathForTarget(
			target,
			(parentOptions.dbPath as string | undefined) ?? undefined,
		)
		const isInteractiveTty = Boolean(process.stdout.isTTY)
		const useInk = Boolean(options.ink || (isInteractiveTty && !options.quiet))

		// Prefer Ink UI for interactive terminals
		if (useInk) {
			const exitCode = await runScanView({
				romsDir,
				dbPath,
				includeHashes: options.hashes,
				verbose: options.verbose,
				quiet: options.quiet,
				outputFile: options.output,
			})
			if (exitCode !== 0) await exitWithCode(exitCode)
			return
		}

		const manifest = await scanCollection(romsDir, {
			includeHashes: options.hashes,
			verbose: options.verbose,
			quiet: options.quiet,
		})

		if (options.output) {
			exportManifest(manifest, options.output)
			ui.success(`Manifest exported to ${options.output}`)
		}

		// Rich stats summary (pure computation; keeps scan fast)
		if (!options.quiet) {
			const stats = computeScanStats(manifest)
			ui.info("")
			ui.header("Scan Summary")
			ui.info(
				`Coverage: metadata ${stats.coverage.withMetadata}/${stats.totals.roms} (${(
					(stats.coverage.withMetadata / Math.max(1, stats.totals.roms)) *
					100
				).toFixed(
					1,
				)}%)  sha1 ${stats.coverage.hasSha1}/${stats.totals.roms}  crc32 ${stats.coverage.hasCrc32}/${stats.totals.roms}`,
			)

			if (stats.regions.overall.length > 0) {
				ui.info(
					`Regions: ${stats.regions.overall
						.map(r => `${r.region} ${r.count}`)
						.join(", ")}`,
				)
			}

			ui.info(
				`Tags: prerelease ${stats.tags.prerelease}  unlicensed ${stats.tags.unlicensed}  hacks ${stats.tags.hack}  homebrew ${stats.tags.homebrew}`,
			)
			ui.info(
				`Variants: ${stats.duplicates.titlesWithVariants} titles with >1 variant`,
			)
			if (stats.duplicates.topTitles.length > 0) {
				ui.info(
					`Top variants: ${stats.duplicates.topTitles
						.map(t => `${t.title} (${t.variants})`)
						.join(", ")}`,
				)
			}
		}

		// Reconcile scanned ROM files into local_roms for accurate search local status
		try {
			if (existsSync(dbPath)) {
				const { getDb, closeDb } = await import("../db/index.js")
				const { recordLocalFile, pruneLocalRoms } =
					await import("../db/queries/local-roms.js")
				const db = getDb(dbPath)
				const keepPaths = new Set<string>()
				for (const sys of manifest.systems) {
					for (const rom of sys.roms) {
						keepPaths.add(rom.path)
						recordLocalFile(db, {
							localPath: rom.path,
							fileSize: rom.size,
							system: inferCatalogSystemKey(sys.system, rom.filename),
							filename: inferCatalogFilename(rom.filename),
							...(rom.sha1 ? { sha1: rom.sha1 } : {}),
							...(rom.crc32 ? { crc32: rom.crc32 } : {}),
						})
					}
				}

				// Prune DB entries for files that no longer exist on disk.
				// This keeps "local" search status accurate after deletions/extraction.
				pruneLocalRoms(db, {
					prefix: romsDir,
					keepPaths,
				})
				closeDb()
			}
		} catch {
			// Best-effort; scan output should still be useful even if DB reconciliation fails
		}

		// SQLite catalog/search stats (optional)
		if (!options.quiet) {
			try {
				if (!existsSync(dbPath)) {
					ui.info("")
					ui.info("Database: (not found)")
					ui.info(`Expected at: ${dbPath}`)
					ui.info(`Run 'retrosd sync ${target}' to build the local catalog.`)
					return
				}

				const { getDb, closeDb } = await import("../db/index.js")
				const { getDbStats } = await import("../db/queries/stats.js")

				const db = getDb(dbPath)
				const stats = getDbStats(db)
				closeDb()

				ui.info("")
				ui.header("Database")
				ui.info(`DB: ${dbPath}`)
				ui.info(
					`Catalog: ${stats.catalog.totalRoms.toLocaleString()} ROMs across ${stats.catalog.systemCount} systems (${stats.catalog.localRoms.toLocaleString()} local)`,
				)
				ui.info(
					`Sync: ${stats.sync.lastSyncedAt ?? "never"}  synced:${stats.sync.statusCounts.synced} stale:${stats.sync.statusCounts.stale} error:${stats.sync.statusCounts.error}`,
				)
			} catch {
				ui.info("")
				ui.info(`DB: ${dbPath}`)
				ui.warn(
					"Database exists but stats could not be read. Run 'retrosd sync' to initialize/migrate.",
				)
			}
		}
	})

// Add verify command
program
	.command("verify")
	.description("Verify ROM integrity against stored hashes")
	.argument("<target>", "Path to SD card root directory")
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.option("--ink", "Use Ink React UI for progress display", false)
	.action(async (target, options) => {
		setupPromptHandlers()

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
		const isInteractiveTty = Boolean(process.stdout.isTTY)
		const useInk = Boolean(options.ink || (isInteractiveTty && !options.quiet))

		if (useInk) {
			const exitCode = await runVerifyView({
				romsDir,
				verbose: options.verbose,
				quiet: options.quiet,
			})
			if (exitCode !== 0) await exitWithCode(exitCode)
			return
		}

		const results = await verifyCollection(romsDir, options)

		const invalid = results.filter(r => !r.valid)
		if (invalid.length > 0) {
			process.exit(1)
		}
	})

// Add convert command
program
	.command("convert")
	.description("Convert disc images to compressed formats (CHD)")
	.argument("<target>", "Path to SD card root directory")
	.option(
		"--systems <list>",
		"Comma-separated system keys (default: all disc-based)",
	)
	.option("--delete-originals", "Delete original files after conversion", false)
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.option("--ink", "Use Ink React UI for progress display", false)
	.action(async (target, options) => {
		setupPromptHandlers()

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
		const systems = options.systems ? options.systems.split(",") : ["PS", "MD"]
		const isInteractiveTty = Boolean(process.stdout.isTTY)
		const useInk = Boolean(options.ink || (isInteractiveTty && !options.quiet))

		// Prefer Ink UI for interactive terminals
		if (useInk) {
			const exitCode = await runConvertView({
				romsDir,
				systems: systems.map((s: string) => s.trim()),
				deleteOriginals: options.deleteOriginals,
				verbose: options.verbose,
				quiet: options.quiet,
			})
			if (exitCode !== 0) await exitWithCode(exitCode)
			return
		}

		ui.header("Converting Disc Images")

		let totalConverted = 0
		let totalFailed = 0
		let totalSkipped = 0

		for (const system of systems) {
			const systemDir = join(romsDir, system.trim())
			if (!existsSync(systemDir)) {
				ui.warn(`System directory not found: ${system}`)
				continue
			}

			ui.info(`Converting ${system}...`)
			const result = await convertRomsInDirectory(systemDir, {
				deleteOriginals: options.deleteOriginals,
				verbose: options.verbose,
				quiet: options.quiet,
			})

			totalConverted += result.converted
			totalFailed += result.failed
			totalSkipped += result.skipped

			if (!options.quiet) {
				ui.success(
					`${system}: ${result.converted} converted, ${result.skipped} skipped, ${result.failed} failed`,
				)
			}
		}

		ui.info(
			`\nTotal: ${totalConverted} converted, ${totalSkipped} skipped, ${totalFailed} failed`,
		)
	})

// Add export command
program
	.command("export")
	.description("Export collection manifest for external tools")
	.argument("<target>", "Path to SD card root directory")
	.option("-o, --output <file>", "Output file path", "collection.json")
	.option("--format <type>", "Export format: json, romm, es", "json")
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.action(async (target, options) => {
		setupPromptHandlers()

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
		const manifest = await scanCollection(romsDir, {
			includeHashes: true,
			verbose: options.verbose,
			quiet: options.quiet,
		})

		exportManifest(manifest, options.output)
		ui.success(`Collection exported to ${options.output}`)
	})

// Add metadata command
program
	.command("metadata")
	.description("Generate metadata files for existing ROMs")
	.argument("<target>", "Path to SD card root directory")
	.option("--systems <list>", "Comma-separated system keys (default: all)")
	.option("--with-hashes", "Compute SHA-1/CRC32 hashes (slower)", false)
	.option("--overwrite", "Overwrite existing metadata files", false)
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.action(async (target, options) => {
		setupPromptHandlers()

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
		const { generateMetadataForExisting } = await import("../metadata.js")

		const systems = options.systems
			? options.systems.split(",").map((s: string) => s.trim())
			: undefined

		ui.header("Generating Metadata")

		const result = await generateMetadataForExisting(romsDir, {
			systems,
			withHashes: options.withHashes,
			overwrite: options.overwrite,
			verbose: options.verbose,
			quiet: options.quiet,
		})

		if (!options.quiet) {
			ui.success(
				`Generated ${result.created} metadata files, skipped ${result.skipped}, failed ${result.failed}`,
			)
		}
	})

// Add scrape command
program
	.command("scrape")
	.description("Download artwork from ScreenScraper for EmulationStation")
	.argument("<target>", "Path to SD card root directory")
	.option("--systems <list>", "Comma-separated system keys (default: all)")
	.option("--username <user>", "ScreenScraper username (for higher limits)")
	.option("--password <pass>", "ScreenScraper password")
	.option(
		"--dev-id <id>",
		"ScreenScraper developer ID (or SCREENSCRAPER_DEV_ID)",
		"",
	)
	.option(
		"--dev-password <pass>",
		"ScreenScraper developer password (or SCREENSCRAPER_DEV_PASSWORD)",
		"",
	)
	.option("--no-box", "Skip box art")
	.option("--screenshot", "Download screenshots", false)
	.option("--video", "Download videos (slow, large files)", false)
	.option("--overwrite", "Re-download existing media", false)
	.option(
		"-j, --jobs <n>",
		"Concurrent scrapes (auto-detected from account, or specify manually)",
		"",
	)
	.option(
		"--download-jobs <n>",
		"Concurrent media downloads (default: 2x lookup threads, max 16)",
		"",
	)
	.option("--include-unknown", "Include ROMs with unknown extensions", false)
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.option("--ink", "Use Ink React UI for progress display", false)
	.action(async (target, options, command) => {
		setupPromptHandlers()
		const config = loadConfig()
		const parentOptions = command.parent?.opts?.() ?? {}

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")

		const systemsArg = (options.systems ?? parentOptions.systems) as
			| string
			| undefined
		const systems = systemsArg
			? systemsArg.split(",").map((s: string) => s.trim())
			: (config.defaultSystems ?? ["GB", "GBA", "GBC", "FC", "MD", "PS"])

		const scrapeUsername = (options.username ?? parentOptions.username) as
			| string
			| undefined
		const scrapePassword = (options.password ?? parentOptions.password) as
			| string
			| undefined
		const resolvedUsername = (scrapeUsername ?? config.scrapeUsername)?.trim()
		const resolvedPassword = (scrapePassword ?? config.scrapePassword)?.trim()
		const hasUserCreds = Boolean(resolvedUsername && resolvedPassword)

		const devId = String(
			(options.devId ||
				parentOptions.devId ||
				config.scrapeDevId ||
				process.env["SCREENSCRAPER_DEV_ID"] ||
				"") as string,
		).trim()
		const devPassword = String(
			(options.devPassword ||
				parentOptions.devPassword ||
				config.scrapeDevPassword ||
				process.env["SCREENSCRAPER_DEV_PASSWORD"] ||
				"") as string,
		).trim()
		const hasDevCreds = Boolean(devId && devPassword)

		const isInteractiveTty = Boolean(process.stdout.isTTY)
		const useInk = Boolean(options.ink || (isInteractiveTty && !options.quiet))

		const scraperOptions: ScraperOptions = {
			systemDirs: systems.map((s: string) => ({
				path: join(romsDir, s),
				system: s,
			})),
			dbPath: resolveDbPathForTarget(
				target,
				(parentOptions.dbPath as string | undefined) ?? undefined,
			),
			boxArt: options.box,
			screenshot: options.screenshot,
			video: options.video,
			...(hasUserCreds
				? { username: resolvedUsername!, password: resolvedPassword! }
				: {}),
			...(hasDevCreds ? { devId, devPassword } : {}),
			verbose: options.verbose,
			overwrite: options.overwrite,
			includeUnknown: options.includeUnknown,
		}

		// Prefer Ink UI for interactive terminals
		if (useInk) {
			const { validateCredentials } = await import("../core/scraper/api.js")

			// Determine thread count based on authentication
			let maxThreads = 1
			let maxThreadsKnown = false
			if (hasUserCreds) {
				const validation = await validateCredentials(
					resolvedUsername!,
					resolvedPassword!,
					hasDevCreds ? devId : undefined,
					hasDevCreds ? devPassword : undefined,
				)
				if (validation.valid && validation.maxThreads) {
					maxThreads = validation.maxThreads
					maxThreadsKnown = true
				} else {
					// Validation can fail without dev credentials; use a conservative guess
					maxThreads = 2
				}
			}

			const requestedJobs = parseInt(options.jobs, 10)
			const requestedConcurrency =
				Number.isFinite(requestedJobs) && requestedJobs > 0
					? Math.min(requestedJobs, 16)
					: undefined
			scraperOptions.concurrency = requestedConcurrency
				? maxThreadsKnown
					? Math.min(requestedConcurrency, maxThreads)
					: requestedConcurrency
				: maxThreads

			const requestedDownloadJobs = parseInt(options.downloadJobs, 10)
			if (Number.isFinite(requestedDownloadJobs) && requestedDownloadJobs > 0) {
				scraperOptions.downloadConcurrency = Math.min(
					requestedDownloadJobs,
					scraperOptions.concurrency,
				)
			}

			const rendered = renderScrape(scraperOptions)
			await rendered.waitUntilExit()
			const result = rendered.result
			if (result === null || (result.failed ?? 0) > 0) {
				await exitWithCode(1)
				return
			}

			// Generate gamelist.xml files after scraping
			if (!options.quiet) {
				ui.info("Generating gamelist.xml files…")
			}
			const { generateGamelist } = await import("../scrape.js")
			const { writeFileSync } = await import("node:fs")
			for (const system of systems) {
				const systemDir = join(romsDir, system.trim())
				if (!existsSync(systemDir)) {
					continue
				}
				const gamelist = generateGamelist(systemDir, system)
				writeFileSync(join(systemDir, "gamelist.xml"), gamelist, "utf8")
			}
			if (!options.quiet) {
				ui.success("gamelist.xml generation complete")
			}
			return
		}

		// Plain-text fallback (no Ink). Uses the core generator (no ora).
		const { validateCredentials } = await import("../core/scraper/api.js")

		ui.header("Scraping Artwork from ScreenScraper")
		if (!options.quiet) {
			ui.info(`Media will be saved to: ${romsDir}/<system>/media/`)
		}

		// Determine thread count based on authentication
		let maxThreads = 1
		let maxThreadsKnown = false
		if (hasUserCreds) {
			const validation = await validateCredentials(
				resolvedUsername!,
				resolvedPassword!,
				hasDevCreds ? devId : undefined,
				hasDevCreds ? devPassword : undefined,
			)
			if (validation.valid && validation.maxThreads) {
				maxThreads = validation.maxThreads
				maxThreadsKnown = true
				if (!options.quiet) {
					ui.info(
						`✓ Authenticated as: ${resolvedUsername} (${maxThreads} threads allowed)`,
					)
				}
			} else {
				maxThreads = 2
				if (!options.quiet) {
					ui.info(
						`✓ Using account: ${resolvedUsername} (assuming ${maxThreads} threads)`,
					)
				}
			}
		} else if (!options.quiet) {
			ui.warn(
				"Tip: Register at screenscraper.fr and use --username/--password for faster scraping",
			)
		}

		const requestedJobs = parseInt(options.jobs, 10)
		const requestedConcurrency =
			Number.isFinite(requestedJobs) && requestedJobs > 0
				? Math.min(requestedJobs, 16)
				: undefined
		scraperOptions.concurrency = requestedConcurrency
			? maxThreadsKnown
				? Math.min(requestedConcurrency, maxThreads)
				: requestedConcurrency
			: maxThreads

		const requestedDownloadJobs = parseInt(options.downloadJobs, 10)
		if (Number.isFinite(requestedDownloadJobs) && requestedDownloadJobs > 0) {
			scraperOptions.downloadConcurrency = Math.min(
				requestedDownloadJobs,
				scraperOptions.concurrency,
			)
		}

		const { generateGamelist } = await import("../scrape.js")
		const { writeFileSync } = await import("node:fs")

		const plainResult = await runScrapePlain(scraperOptions, {
			quiet: options.quiet || !isInteractiveTty,
		})

		// Generate gamelist.xml files after scraping
		for (const system of systems) {
			const systemDir = join(romsDir, system.trim())
			if (!existsSync(systemDir)) {
				continue
			}
			const gamelist = generateGamelist(systemDir, system)
			writeFileSync(join(systemDir, "gamelist.xml"), gamelist, "utf8")
			if (!options.quiet) {
				ui.success(`Generated gamelist.xml for ${system}`)
			}
		}

		if (plainResult.failed > 0) {
			process.exit(1)
		}
	})

// ─────────────────────────────────────────────────────────────────────────────
// Main Action
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
	target: string
	dbPath?: string
	dryRun: boolean
	jobs: string
	biosOnly: boolean
	romsOnly: boolean
	ink: boolean
	preset?: string
	filter?: string
	sources?: string
	systems?: string
	resume: boolean
	nonInteractive: boolean
	quiet: boolean
	verbose: boolean
	includePrerelease?: boolean
	includeUnlicensed?: boolean
	includeHacks?: boolean
	includeHomebrew?: boolean
	includePattern?: string
	excludePattern?: string
	includeFrom?: string
	excludeFrom?: string
	region?: string
	regionPriority?: string
	lang?: string
	langScope?: string
	langInfer: boolean
	langPriority?: string
	update: boolean
	diskProfile: string
	// New options
	"1g1r": boolean // Note: commander converts --no-1g1r to false
	metadata: boolean // Note: commander converts --no-metadata to false
	verifyHashes: boolean
	convertChd: boolean
	// Scrape options
	scrape: boolean
	username?: string
	password?: string
	devId?: string
	devPassword?: string
	scrapeMedia?: string
}

async function run(
	target: string,
	options: Omit<CliArgs, "target">,
): Promise<void> {
	setupPromptHandlers()

	// Load config
	const config = loadConfig()

	// Merge CLI options with config defaults
	const jobs = Math.min(
		Math.max(parseInt(options.jobs, 10) || config.jobs, 1),
		16,
	)
	const dryRun = options.dryRun
	const resume = options.resume
	const quiet = options.quiet
	const verbose = options.verbose
	const _biosOnly = options.biosOnly
	const romsOnly = options.romsOnly
	const nonInteractive = options.nonInteractive || !process.stdin.isTTY
	const includePrerelease =
		options.includePrerelease ?? config.includePrerelease
	const includeUnlicensed =
		options.includeUnlicensed ?? config.includeUnlicensed
	const includeHacks = options.includeHacks ?? config.includeHacks
	const includeHomebrew = options.includeHomebrew ?? config.includeHomebrew
	const update = options.update

	const includePatterns = parsePatternList(options.includePattern)
	const excludePatterns = parsePatternList(options.excludePattern)

	const normalizePriorityList = (
		value: string[] | undefined,
		normalizer: (input: string) => string | null,
		label: string,
	): string[] | undefined => {
		if (!value || value.length === 0) return undefined
		const normalized: string[] = []
		const invalid: string[] = []
		for (const entry of value) {
			const code = normalizer(entry)
			if (code) {
				if (!normalized.includes(code)) normalized.push(code)
			} else {
				invalid.push(entry)
			}
		}
		if (invalid.length > 0 && !quiet) {
			ui.warn(`Ignoring unknown ${label} codes: ${invalid.join(", ")}`)
		}
		return normalized.length > 0 ? normalized : undefined
	}

	let includeList: Set<string> | undefined
	if (options.includeFrom) {
		if (!existsSync(options.includeFrom)) {
			ui.error(`Include list not found: ${options.includeFrom}`)
			process.exit(1)
		}
		includeList = loadFilterList(options.includeFrom)
	}

	let excludeList: Set<string> | undefined
	if (options.excludeFrom) {
		if (!existsSync(options.excludeFrom)) {
			ui.error(`Exclude list not found: ${options.excludeFrom}`)
			process.exit(1)
		}
		excludeList = loadFilterList(options.excludeFrom)
	}

	let preferredRegion = options.region ?? config.region
	if (preferredRegion && !normalizeRegionCode(preferredRegion)) {
		if (!quiet) ui.warn(`Ignoring unknown region code: ${preferredRegion}`)
		preferredRegion = undefined
	}

	let preferredLanguage = options.lang ?? config.lang
	if (preferredLanguage && !normalizeLanguageCode(preferredLanguage)) {
		if (!quiet) ui.warn(`Ignoring unknown language code: ${preferredLanguage}`)
		preferredLanguage = undefined
	}

	let includeRegionCodes: string[] | undefined
	let includeLanguageCodes: string[] | undefined
	let inferLanguageCodes: boolean | undefined

	let regionPriority = normalizePriorityList(
		options.regionPriority
			? options.regionPriority
					.split(",")
					.map(s => s.trim())
					.filter(Boolean)
			: config.regionPriority,
		normalizeRegionCode,
		"region priority",
	)

	let languagePriority = normalizePriorityList(
		options.langPriority
			? options.langPriority
					.split(",")
					.map(s => s.trim())
					.filter(Boolean)
			: config.langPriority,
		normalizeLanguageCode,
		"language priority",
	)

	// Language filter inference toggle (defaults to true via commander)
	if (typeof options.langInfer === "boolean") {
		inferLanguageCodes = options.langInfer
	}

	// Optional language scope behavior for --lang
	if (options.langScope) {
		const scope = String(options.langScope).trim().toLowerCase()
		const normalizedPreferred = preferredLanguage
		if (!normalizedPreferred) {
			if (!quiet)
				ui.warn("Ignoring --lang-scope because no valid --lang was provided")
		} else if (scope === "strict") {
			includeLanguageCodes = [normalizedPreferred]
			preferredLanguage = normalizedPreferred
			languagePriority = [normalizedPreferred]
		} else if (scope === "fallback") {
			includeLanguageCodes = Array.from(
				new Set([normalizedPreferred, "en"].filter(Boolean)),
			)
			preferredLanguage = normalizedPreferred
			languagePriority = [normalizedPreferred, "en"].filter(Boolean)
		} else if (scope !== "prefer") {
			if (!quiet)
				ui.warn(
					`Ignoring unknown --lang-scope value: ${options.langScope} (use prefer|strict|fallback)`,
				)
		}
	}

	// Validate disk profile
	const validProfiles = ["fast", "balanced", "slow"] as const
	const diskProfile = validProfiles.includes(
		options.diskProfile as (typeof validProfiles)[number],
	)
		? (options.diskProfile as DiskProfile)
		: "balanced"

	// Validate target directory
	if (!existsSync(target)) {
		ui.error(`Directory does not exist: ${target}`)
		process.exit(1)
	}

	// Set up paths
	const biosDir = join(target, "Bios")
	const romsDir = join(target, "Roms")
	const dbPath = resolveDbPathForTarget(target, options.dbPath)

	// Print banner
	if (dryRun) {
		ui.dryRunBanner()
	}

	ui.banner(
		VERSION,
		target,
		jobs,
		options.filter ?? options.preset,
		diskProfile,
	)

	// Create directories
	await createRomDirectories(romsDir)

	// Download options
	const downloadOptions = {
		dryRun,
		resume,
		verbose,
		quiet,
		jobs,
		retryCount: config.retryCount,
		retryDelay: config.retryDelay,
		update,
	}

	// Track results for summary
	const allBiosResults: DownloadResult[] = []
	const allRomResults: DownloadResult[] = []
	const allScrapeResults: DownloadResult[] = []

	// ─────────────────────────────────────────────────────────────────────────────
	// BIOS Downloads
	// ─────────────────────────────────────────────────────────────────────────────

	if (!romsOnly) {
		let shouldDownloadBios = true
		if (!nonInteractive) {
			shouldDownloadBios = await promptConfirmBiosDownload()
		}

		if (shouldDownloadBios) {
			const biosSummary = await downloadBios(biosDir, downloadOptions)
			allBiosResults.push(...biosSummary.completed, ...biosSummary.failed)
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// ROM Downloads
	// ─────────────────────────────────────────────────────────────────────────────

	if (!_biosOnly) {
		// Load saved preferences for interactive prompts
		const savedPrefs = loadPreferences(target)

		const baselinePreferredRegion = preferredRegion
		const baselineRegionPriority = regionPriority
		const baselinePreferredLanguage = preferredLanguage
		const baselineLanguagePriority = languagePriority

		// Apply saved 1G1R preferences when not explicitly set via CLI/config
		if (
			!options.region &&
			!options.regionPriority &&
			savedPrefs.preferredRegion
		) {
			const normalized = normalizeRegionCode(savedPrefs.preferredRegion)
			if (normalized) preferredRegion = normalized
		}
		if (
			!options.lang &&
			!options.langPriority &&
			savedPrefs.preferredLanguage
		) {
			const normalized = normalizeLanguageCode(savedPrefs.preferredLanguage)
			if (normalized) preferredLanguage = normalized
		}
		if (!options.regionPriority && savedPrefs.regionPriority?.length) {
			regionPriority = savedPrefs.regionPriority
		}
		if (!options.langPriority && savedPrefs.languagePriority?.length) {
			languagePriority = savedPrefs.languagePriority
		}
		if (savedPrefs.includeRegionCodes?.length && !includeRegionCodes) {
			includeRegionCodes = savedPrefs.includeRegionCodes
		}
		if (savedPrefs.includeLanguageCodes?.length && !includeLanguageCodes) {
			includeLanguageCodes = savedPrefs.includeLanguageCodes
		}
		if (savedPrefs && inferLanguageCodes === undefined) {
			// Default to inference enabled unless explicitly overridden by CLI.
			inferLanguageCodes = true
		}

		let selectedSources: Source[]
		let selectedEntries: RomEntry[]
		let preset: RegionPreset | undefined
		let filter: string | undefined
		let selectedOneG1RProfile: "default" | "eu-lang-fallback" | undefined

		// Handle sources
		if (options.sources) {
			selectedSources = options.sources
				.split(",")
				.map(s => s.trim().replace("-", "-") as Source)
		} else if (nonInteractive) {
			ui.info("Skipping ROM downloads (non-interactive, no sources specified).")
			await printSummary(
				allBiosResults,
				allRomResults,
				allScrapeResults,
				dryRun,
			)
			return
		} else {
			// Interactive: prompt for confirmation first
			const shouldDownloadRoms = await promptConfirmRomDownload(savedPrefs)
			if (!shouldDownloadRoms) {
				ui.info("Skipping ROM downloads.")
				await printSummary(
					allBiosResults,
					allRomResults,
					allScrapeResults,
					dryRun,
				)
				return
			}

			selectedSources = await promptSources(savedPrefs)
		}

		// Handle systems
		if (options.systems) {
			const keys = options.systems.split(",").map(s => s.trim())
			selectedEntries = getEntriesByKeys(keys).filter(e =>
				selectedSources.includes(e.source),
			)
		} else if (nonInteractive) {
			selectedEntries = getEntriesBySources(selectedSources)
		} else {
			selectedEntries = await promptSystems(selectedSources, savedPrefs)
		}

		if (selectedEntries.length === 0) {
			ui.info("No ROM systems selected.")
			await printSummary(
				allBiosResults,
				allRomResults,
				allScrapeResults,
				dryRun,
			)
			return
		}

		// Handle filter
		if (options.preset) {
			preset = options.preset as RegionPreset
		} else if (options.filter) {
			filter = options.filter
		} else if (!nonInteractive) {
			const filterChoice = await promptFilter(savedPrefs)
			preset = filterChoice.preset
			filter = filterChoice.custom
		}

		// Optional 1G1R preference profile (interactive only)
		const enable1G1R = options["1g1r"]
		const hasExternalPriorityOverrides =
			!!options.region ||
			!!options.lang ||
			!!options.regionPriority ||
			!!options.langPriority ||
			!!config.region ||
			!!config.lang ||
			!!config.regionPriority?.length ||
			!!config.langPriority?.length
		if (
			!nonInteractive &&
			enable1G1R !== false &&
			!hasExternalPriorityOverrides
		) {
			const profile = await promptOneG1RProfile(savedPrefs)
			if (profile.kind === "eu-lang-fallback") {
				selectedOneG1RProfile = "eu-lang-fallback"
				const normalizedPrimary = normalizeLanguageCode(profile.primaryLanguage)
				if (!normalizedPrimary) {
					if (!quiet)
						ui.warn(
							`Ignoring unknown language code: ${profile.primaryLanguage}`,
						)
				} else {
					// Build allowed pool and tie-break rules:
					// EU <primary> -> EU EN -> US
					includeRegionCodes = ["eu", "us"]
					includeLanguageCodes = Array.from(new Set([normalizedPrimary, "en"]))
					regionPriority = ["eu", "us"]
					preferredLanguage = normalizedPrimary
					languagePriority = [normalizedPrimary, "en"]
					// Ensure the regex preset doesn't accidentally exclude USA.
					preset = "all"
					filter = undefined
				}
			} else {
				selectedOneG1RProfile = "default"
				includeRegionCodes = undefined
				includeLanguageCodes = undefined
				preferredRegion = baselinePreferredRegion
				regionPriority = baselineRegionPriority
				preferredLanguage = baselinePreferredLanguage
				languagePriority = baselineLanguagePriority
			}
		}

		// Handle scrape options interactively
		let shouldScrape = options.scrape
		let scrapeMedia = options.scrapeMedia
		let generateMetadata = options.metadata

		if (!nonInteractive) {
			generateMetadata = await promptMetadataOptions()

			if (!shouldScrape) {
				const scrapeChoice = await promptScrapeOptions(savedPrefs)
				shouldScrape = scrapeChoice.scrape
				if (shouldScrape) {
					scrapeMedia = scrapeChoice.media.join(",")
				}
			}
		}

		// Save user selections for next run
		if (!nonInteractive) {
			const prefsUpdate: Partial<UserPreferences> = {
				systems: selectedEntries.map(e => e.key),
				scrape: shouldScrape,
			}

			if (selectedOneG1RProfile === "default") {
				prefsUpdate.preferredRegion = ""
				prefsUpdate.regionPriority = []
				prefsUpdate.preferredLanguage = ""
				prefsUpdate.languagePriority = []
				prefsUpdate.includeRegionCodes = []
				prefsUpdate.includeLanguageCodes = []
			} else {
				if (preferredRegion) prefsUpdate.preferredRegion = preferredRegion
				if (regionPriority) prefsUpdate.regionPriority = regionPriority
				if (preferredLanguage) prefsUpdate.preferredLanguage = preferredLanguage
				if (languagePriority) prefsUpdate.languagePriority = languagePriority
				if (includeRegionCodes)
					prefsUpdate.includeRegionCodes = includeRegionCodes
				if (includeLanguageCodes)
					prefsUpdate.includeLanguageCodes = includeLanguageCodes
			}

			if (shouldScrape && scrapeMedia) {
				prefsUpdate.scrapeMedia = scrapeMedia.split(",")
			}

			// Build preferences update, clearing the conflicting filter setting
			if (filter !== undefined) {
				// Custom filter: save it and signal clearing preset
				prefsUpdate.customFilter = filter
			} else if (preset !== undefined) {
				// Preset: save it and signal clearing custom filter
				prefsUpdate.preset = preset
			}

			updatePreferences(target, prefsUpdate)
		}

		// Download ROMs
		const isInteractiveTty = Boolean(process.stdout.isTTY)
		const useInk = options.ink || (isInteractiveTty && !quiet)

		if (useInk) {
			const inkOptions = {
				dbPath,
				romsDir,
				entries: selectedEntries,
				dryRun,
				verbose,
				jobs,
				retryCount: config.retryCount,
				retryDelay: config.retryDelay,
				update,
				...(preset !== undefined ? { preset } : {}),
				...(filter !== undefined ? { filter } : {}),
				includePrerelease,
				includeUnlicensed,
				includeHacks,
				includeHomebrew,
				...(includePatterns.length > 0 ? { includePatterns } : {}),
				...(excludePatterns.length > 0 ? { excludePatterns } : {}),
				...(includeList ? { includeList } : {}),
				...(excludeList ? { excludeList } : {}),
				...(includeRegionCodes ? { includeRegionCodes } : {}),
				...(includeLanguageCodes ? { includeLanguageCodes } : {}),
				...(inferLanguageCodes !== undefined ? { inferLanguageCodes } : {}),
				...(preferredRegion ? { preferredRegion } : {}),
				...(regionPriority ? { regionPriority } : {}),
				...(preferredLanguage ? { preferredLanguage } : {}),
				...(languagePriority ? { languagePriority } : {}),
				diskProfile,
				enable1G1R: options["1g1r"],
			}

			const rendered = renderDownload(inkOptions)
			await rendered.waitUntilExit()

			const inkResult = rendered.result
			if (inkResult) {
				allRomResults.push({
					label: `ROM downloads (Ink): ${inkResult.completed} completed, ${inkResult.failed} failed`,
					success: inkResult.failed === 0,
					...(inkResult.failed > 0
						? { error: `${inkResult.failed} downloads failed` }
						: {}),
				})
			}

			if (generateMetadata && !dryRun) {
				await generateMetadataForExisting(romsDir, {
					systems: selectedEntries.map(e => e.destDir),
					withHashes: options.verifyHashes,
					overwrite: false,
					verbose,
					quiet,
				})
			}
		} else {
			const romSummary = await downloadRoms(selectedEntries, romsDir, {
				...downloadOptions,
				// Avoid emitting progress bars when piped to non-TTY output
				quiet: quiet || !isInteractiveTty,
				...(preset !== undefined ? { preset } : {}),
				...(filter !== undefined ? { filter } : {}),
				includePrerelease,
				includeUnlicensed,
				includeHacks,
				includeHomebrew,
				...(includePatterns.length > 0 ? { includePatterns } : {}),
				...(excludePatterns.length > 0 ? { excludePatterns } : {}),
				...(includeList ? { includeList } : {}),
				...(excludeList ? { excludeList } : {}),
				...(includeRegionCodes ? { includeRegionCodes } : {}),
				...(includeLanguageCodes ? { includeLanguageCodes } : {}),
				...(inferLanguageCodes !== undefined ? { inferLanguageCodes } : {}),
				...(preferredRegion ? { preferredRegion } : {}),
				...(regionPriority ? { regionPriority } : {}),
				...(preferredLanguage ? { preferredLanguage } : {}),
				...(languagePriority ? { languagePriority } : {}),
				diskProfile,
				enable1G1R: options["1g1r"],
				generateMetadata,
				verifyHashes: options.verifyHashes,
			} as Parameters<typeof downloadRoms>[2])

			allRomResults.push(...romSummary.completed, ...romSummary.failed)
		}

		// Convert to CHD if requested
		if (options.convertChd && !dryRun) {
			ui.header("Converting Disc Images")

			const discSystems = selectedEntries
				.filter(e => e.key === "PS" || e.key === "MD_SEGA_CD")
				.map(e => e.destDir)

			for (const system of discSystems) {
				const systemDir = join(romsDir, system)
				if (existsSync(systemDir)) {
					ui.info(`Converting ${system} to CHD...`)
					const result = await convertRomsInDirectory(systemDir, {
						deleteOriginals: true,
						verbose,
						quiet,
					})

					ui.info(
						`${system}: ${result.converted} converted, ${result.skipped} skipped, ${result.failed} failed`,
					)
				}
			}
		}

		// Scrape artwork if requested
		if (shouldScrape && !dryRun) {
			const { generateGamelist } = await import("../scrape.js")
			const { writeFileSync } = await import("node:fs")

			const mediaList = (scrapeMedia || "box").split(",")

			const username = options.username ?? config.scrapeUsername
			const password = options.password ?? config.scrapePassword
			const devId = options.devId ?? config.scrapeDevId
			const devPassword = options.devPassword ?? config.scrapeDevPassword

			const systemDirs = selectedEntries
				.map(entry => ({
					system: entry.key,
					path: join(romsDir, entry.destDir),
				}))
				.filter(({ path }) => existsSync(path))

			const scraperOptions: ScraperOptions = {
				systemDirs,
				dbPath,
				boxArt: mediaList.includes("box"),
				screenshot: mediaList.includes("screenshot"),
				video: mediaList.includes("video"),
				verbose: options.verbose,
				...(username && password ? { username, password } : {}),
				...(devId && devPassword ? { devId, devPassword } : {}),
				...(Number.isFinite(jobs) ? { concurrency: jobs } : {}),
			}

			const isInteractiveTty = Boolean(process.stdout.isTTY)
			const useInk = options.ink || (isInteractiveTty && !quiet)
			if (useInk) {
				const rendered = renderScrape(scraperOptions)
				await rendered.waitUntilExit()
				const result = rendered.result
				const failed = result?.failed ?? 1
				const completed = result?.completed ?? 0
				allScrapeResults.push({
					label:
						result === null
							? "Artwork scrape (Ink): aborted"
							: `Artwork scrape (Ink): ${completed} processed, ${failed} failed`,
					success: result !== null && failed === 0,
					...(result === null
						? { error: "Scrape aborted (quit before completion)" }
						: failed > 0
							? { error: `${failed} scrape errors` }
							: {}),
				})
			} else {
				const plainResult = await runScrapePlain(scraperOptions, {
					quiet: quiet || !isInteractiveTty,
				})
				allScrapeResults.push({
					label: `Artwork scrape: ${plainResult.failed} failed`,
					success: plainResult.failed === 0,
					...(plainResult.failed > 0
						? { error: `${plainResult.failed} scrape errors` }
						: {}),
				})
			}

			for (const { system, path } of systemDirs) {
				const gamelist = generateGamelist(path, system)
				writeFileSync(join(path, "gamelist.xml"), gamelist, "utf8")
				if (!options.quiet) {
					ui.success(`Generated gamelist.xml for ${system}`)
				}
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Summary
	// ─────────────────────────────────────────────────────────────────────────────

	await printSummary(allBiosResults, allRomResults, allScrapeResults, dryRun)
}

async function printSummary(
	biosResults: DownloadResult[],
	romResults: DownloadResult[],
	scrapeResults: DownloadResult[],
	dryRun: boolean,
): Promise<void> {
	ui.header("Summary")

	const biosCompleted = biosResults.filter(r => r.success)
	const biosFailed = biosResults.filter(r => !r.success)
	const romCompleted = romResults.filter(r => r.success)
	const romFailed = romResults.filter(r => !r.success)
	const scrapeCompleted = scrapeResults.filter(r => r.success)
	const scrapeFailed = scrapeResults.filter(r => !r.success)

	if (biosCompleted.length > 0) {
		ui.summarySection(
			"BIOS Downloads Completed",
			biosCompleted.map(r => r.label),
			"green",
		)
	}

	if (biosFailed.length > 0) {
		console.log()
		ui.summarySection(
			"BIOS Downloads Failed",
			biosFailed.map(r => r.label + (r.error ? ` - ${r.error}` : "")),
			"red",
		)
	}

	if (romCompleted.length > 0) {
		console.log()
		ui.summarySection(
			"ROM Downloads Completed",
			romCompleted.map(r => r.label),
			"green",
		)
	}

	if (romFailed.length > 0) {
		console.log()
		ui.summarySection(
			"ROM Downloads Failed",
			romFailed.map(r => r.label + (r.error ? ` - ${r.error}` : "")),
			"red",
		)
	}

	if (scrapeCompleted.length > 0) {
		console.log()
		ui.summarySection(
			"Artwork Scrape Completed",
			scrapeCompleted.map(r => r.label),
			"green",
		)
	}

	if (scrapeFailed.length > 0) {
		console.log()
		ui.summarySection(
			"Artwork Scrape Failed",
			scrapeFailed.map(r => r.label + (r.error ? ` - ${r.error}` : "")),
			"red",
		)
	}

	const allSuccess =
		biosFailed.length === 0 &&
		romFailed.length === 0 &&
		scrapeFailed.length === 0
	ui.finalStatus(allSuccess)

	if (dryRun) {
		console.log()
		ui.info("Dry run complete. Run without --dry-run to actually download.")
	} else if (allSuccess) {
		console.log()
		ui.success("Setup complete!")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

program.parse()
