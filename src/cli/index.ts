#!/usr/bin/env node
/**
 * RetroSD CLI - Brick SD Card Creator
 * State-of-the-art BIOS & ROM downloader for retro gaming consoles
 * Enhanced with DAT-style verification, metadata generation, and library management
 */

import "../bootstrap.js"
import { existsSync } from "node:fs"
import { join } from "node:path"
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
import {
	promptConfirmRomDownload,
	promptSources,
	promptSystems,
	promptFilter,
	setupPromptHandlers,
} from "../prompts.js"
import { loadPreferences, updatePreferences } from "../preferences.js"
import {
	scanCollection,
	verifyCollection,
	exportManifest,
} from "../collection.js"
import { convertRomsInDirectory } from "../convert.js"
import type {
	Source,
	RomEntry,
	RegionPreset,
	DownloadResult,
	DiskProfile,
} from "../types.js"

const VERSION = "2.0.0"

// ─────────────────────────────────────────────────────────────────────────────
// CLI Definition
// ─────────────────────────────────────────────────────────────────────────────

const program = new Command()

program
	.name("retrosd")
	.version(VERSION)
	.description(
		"Brick SD Card Creator – BIOS & ROM downloader for retro gaming consoles",
	)
	.argument("<target>", "Path to SD card root directory")
	.option("-n, --dry-run", "Preview actions without downloading", false)
	.option("-j, --jobs <number>", "Number of parallel downloads", "4")
	.option("--bios-only", "Only download BIOS files", false)
	.option("--roms-only", "Only download ROMs (skip BIOS)", false)
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
	.option("--include-prerelease", "Include beta/demo/proto ROMs", false)
	.option("--include-unlicensed", "Include unlicensed/pirate ROMs", false)
	.option("--update", "Revalidate remote ROMs and redownload if changed", false)
	.option(
		"--disk-profile <profile>",
		"Disk speed profile: fast (SSD), balanced (HDD), slow (SD card/NAS)",
		"balanced",
	)
	.option("--no-1g1r", "Disable 1G1R (one-game-one-ROM) filtering", false)
	.option("--no-metadata", "Skip metadata generation", false)
	.option("--verify-hashes", "Generate and verify SHA-1/CRC32 hashes", false)
	.option("--convert-chd", "Convert disc images to CHD format", false)
	.action(run)

// Add scan command
program
	.command("scan")
	.description("Scan and catalog installed ROMs")
	.argument("<target>", "Path to SD card root directory")
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.option("--hashes", "Compute SHA-1/CRC32 hashes (slower)", false)
	.option("-o, --output <file>", "Export manifest to JSON file")
	.action(async (target, options) => {
		setupPromptHandlers()

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
		const manifest = await scanCollection(romsDir, {
			includeHashes: options.hashes,
			verbose: options.verbose,
			quiet: options.quiet,
		})

		if (options.output) {
			exportManifest(manifest, options.output)
			ui.success(`Manifest exported to ${options.output}`)
		}
	})

// Add verify command
program
	.command("verify")
	.description("Verify ROM integrity against stored hashes")
	.argument("<target>", "Path to SD card root directory")
	.option("-q, --quiet", "Minimal output", false)
	.option("--verbose", "Debug output", false)
	.action(async (target, options) => {
		setupPromptHandlers()

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
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
	.action(async (target, options) => {
		setupPromptHandlers()

		if (!existsSync(target)) {
			ui.error(`Directory does not exist: ${target}`)
			process.exit(1)
		}

		const romsDir = join(target, "Roms")
		const systems = options.systems ? options.systems.split(",") : ["PS", "MD"]

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

// ─────────────────────────────────────────────────────────────────────────────
// Main Action
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
	target: string
	dryRun: boolean
	jobs: string
	biosOnly: boolean
	romsOnly: boolean
	preset?: string
	filter?: string
	sources?: string
	systems?: string
	resume: boolean
	nonInteractive: boolean
	quiet: boolean
	verbose: boolean
	includePrerelease: boolean
	includeUnlicensed: boolean
	update: boolean
	diskProfile: string
	// New options
	"1g1r": boolean // Note: commander converts --no-1g1r to false
	metadata: boolean // Note: commander converts --no-metadata to false
	verifyHashes: boolean
	convertChd: boolean
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
	const biosOnly = options.biosOnly
	const romsOnly = options.romsOnly
	const nonInteractive = options.nonInteractive || !process.stdin.isTTY
	const includePrerelease =
		options.includePrerelease ?? config.includePrerelease
	const includeUnlicensed =
		options.includeUnlicensed ?? config.includeUnlicensed
	const update = options.update

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

	// ─────────────────────────────────────────────────────────────────────────────
	// BIOS Downloads
	// ─────────────────────────────────────────────────────────────────────────────

	if (!romsOnly) {
		const biosSummary = await downloadBios(biosDir, downloadOptions)
		allBiosResults.push(...biosSummary.completed, ...biosSummary.failed)
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// ROM Downloads
	// ─────────────────────────────────────────────────────────────────────────────

	if (!biosOnly) {
		// Load saved preferences for interactive prompts
		const savedPrefs = loadPreferences(target)

		let selectedSources: Source[]
		let selectedEntries: RomEntry[]
		let preset: RegionPreset | undefined
		let filter: string | undefined

		// Handle sources
		if (options.sources) {
			selectedSources = options.sources
				.split(",")
				.map(s => s.trim().replace("-", "-") as Source)
		} else if (nonInteractive) {
			ui.info("Skipping ROM downloads (non-interactive, no sources specified).")
			await printSummary(allBiosResults, allRomResults, dryRun)
			return
		} else {
			// Interactive: prompt for confirmation first
			const shouldDownloadRoms = await promptConfirmRomDownload(savedPrefs)
			if (!shouldDownloadRoms) {
				ui.info("Skipping ROM downloads.")
				await printSummary(allBiosResults, allRomResults, dryRun)
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
			await printSummary(allBiosResults, allRomResults, dryRun)
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

		// Save user selections for next run
		if (!nonInteractive) {
			// Build preferences update, clearing the conflicting filter setting
			if (filter !== undefined) {
				// Custom filter: save it and signal clearing preset
				updatePreferences(target, {
					confirmRomDownload: true,
					sources: selectedSources,
					systems: selectedEntries.map(e => e.key),
					customFilter: filter,
				})
			} else if (preset !== undefined) {
				// Preset: save it and signal clearing custom filter
				updatePreferences(target, {
					confirmRomDownload: true,
					sources: selectedSources,
					systems: selectedEntries.map(e => e.key),
					preset,
				})
			} else {
				updatePreferences(target, {
					confirmRomDownload: true,
					sources: selectedSources,
					systems: selectedEntries.map(e => e.key),
				})
			}
		}

		// Download ROMs
		const romSummary = await downloadRoms(selectedEntries, romsDir, {
			...downloadOptions,
			...(preset !== undefined ? { preset } : {}),
			...(filter !== undefined ? { filter } : {}),
			includePrerelease,
			includeUnlicensed,
			diskProfile,
			enable1G1R: options["1g1r"],
			generateMetadata: options.metadata,
			verifyHashes: options.verifyHashes,
		} as Parameters<typeof downloadRoms>[2])

		allRomResults.push(...romSummary.completed, ...romSummary.failed)

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
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Summary
	// ─────────────────────────────────────────────────────────────────────────────

	await printSummary(allBiosResults, allRomResults, dryRun)
}

async function printSummary(
	biosResults: DownloadResult[],
	romResults: DownloadResult[],
	dryRun: boolean,
): Promise<void> {
	ui.header("Summary")

	const biosCompleted = biosResults.filter(r => r.success)
	const biosFailed = biosResults.filter(r => !r.success)
	const romCompleted = romResults.filter(r => r.success)
	const romFailed = romResults.filter(r => !r.success)

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

	const allSuccess = biosFailed.length === 0 && romFailed.length === 0
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
