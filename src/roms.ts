/**
 * ROM source definitions and download logic
 *
 * State-of-the-art implementation with:
 * - Backpressure control (bytes + concurrency limits)
 * - File size parsing from directory listings
 * - Range resume support via .part files
 * - Streaming ZIP extraction with yauzl
 * - Adaptive concurrency for different disk speeds
 */

import { mkdir } from "node:fs/promises"
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join, basename } from "node:path"
import pLimit from "p-limit"
import { fetch as undiciFetch } from "undici"
import type {
	RomEntry,
	Source,
	DownloadOptions,
	Summary,
	DownloadResult,
	RegionPreset,
	DiskProfile,
} from "./types.js"
import { downloadFile, anyExtensionExists, HTTP_AGENT } from "./download.js"
import {
	applyFilters,
	getPresetFilter,
	getExclusionFilter,
	parseCustomFilter,
} from "./filters.js"
import {
	BackpressureController,
	BACKPRESSURE_DEFAULTS,
} from "./backpressure.js"
import { extractZip, isZipArchive } from "./extract.js"
import { ui } from "./ui.js"

/**
 * Parsed file entry with size information
 */
interface FileEntry {
	filename: string
	size: number // bytes, 0 if unknown
}

/**
 * Source base URLs
 */
const SOURCE_URLS: Record<Source, string> = {
	"no-intro": "https://myrient.erista.me/files/No-Intro",
	redump: "https://myrient.erista.me/files/Redump",
}

/**
 * Map system keys to destination directories
 */
const DEST_DIRS: Record<string, string> = {
	FC_CART: "FC",
	FC_FDS: "FC",
	GB: "GB",
	GBA: "GBA",
	GBC: "GBC",
	MD: "MD",
	MD_SEGA_CD: "MD",
	PCE: "PCE",
	PKM: "PKM",
	SGB: "SGB",
	PS: "PS",
}

/**
 * All ROM entries from the shell script
 */
export const ROM_ENTRIES: RomEntry[] = [
	{
		key: "FC_CART",
		source: "no-intro",
		remotePath: "Nintendo%20-%20Famicom/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.nes",
		label: "Famicom (cart)",
		extract: true,
		destDir: "FC",
	},
	{
		key: "FC_FDS",
		source: "no-intro",
		remotePath: "Nintendo%20-%20Family%20Computer%20Disk%20System%20%28FDS%29/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.fds",
		label: "Famicom Disk System",
		extract: true,
		destDir: "FC",
	},
	{
		key: "GB",
		source: "no-intro",
		remotePath: "Nintendo%20-%20Game%20Boy/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.gb",
		label: "Game Boy",
		extract: true,
		destDir: "GB",
	},
	{
		key: "GBA",
		source: "no-intro",
		remotePath: "Nintendo%20-%20Game%20Boy%20Advance/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.gba",
		label: "Game Boy Advance",
		extract: true,
		destDir: "GBA",
	},
	{
		key: "GBC",
		source: "no-intro",
		remotePath: "Nintendo%20-%20Game%20Boy%20Color/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.gbc",
		label: "Game Boy Color",
		extract: true,
		destDir: "GBC",
	},
	{
		key: "MD",
		source: "no-intro",
		remotePath: "Sega%20-%20Mega%20Drive%20-%20Genesis/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.md",
		label: "Mega Drive / Genesis",
		extract: true,
		destDir: "MD",
	},
	{
		key: "PCE",
		source: "no-intro",
		remotePath: "NEC%20-%20PC%20Engine%20-%20TurboGrafx-16/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.pce",
		label: "PC Engine",
		extract: true,
		destDir: "PCE",
	},
	{
		key: "PKM",
		source: "no-intro",
		remotePath: "Nintendo%20-%20Pokemon%20Mini/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.min",
		label: "Pokemon Mini",
		extract: true,
		destDir: "PKM",
	},
	{
		key: "SGB",
		source: "no-intro",
		remotePath: "Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/",
		archiveRegex: /\.zip$/,
		extractGlob: "*.sfc",
		label: "Super Game Boy (SNES)",
		extract: true,
		destDir: "SGB",
	},
	{
		key: "PS",
		source: "redump",
		remotePath: "Sony%20-%20PlayStation/",
		archiveRegex: /\.(zip|7z)$/,
		extractGlob: "*",
		label: "PlayStation (Redump)",
		extract: false,
		destDir: "PS",
	},
	{
		key: "MD_SEGA_CD",
		source: "redump",
		remotePath: "Sega%20-%20Mega-CD%20-%20Sega%20CD/",
		archiveRegex: /\.(zip|7z)$/,
		extractGlob: "*",
		label: "Mega CD / Sega CD (Redump)",
		extract: false,
		destDir: "MD",
	},
]

/**
 * Get ROM entries filtered by sources
 */
export function getEntriesBySources(sources: Source[]): RomEntry[] {
	return ROM_ENTRIES.filter(entry => sources.includes(entry.source))
}

/**
 * Get ROM entries filtered by keys
 */
export function getEntriesByKeys(keys: string[]): RomEntry[] {
	return ROM_ENTRIES.filter(entry => keys.includes(entry.key))
}

/**
 * Parse listing HTML from myrient to extract file links AND sizes
 *
 * Myrient directory listings include size info in the HTML.
 * Format: <a href="filename.zip">filename.zip</a>  DD-MMM-YYYY HH:MM    SIZE
 * Size can be: "1.2M", "500K", "1.5G", or raw bytes
 */
function parseListing(html: string, archiveRegex: RegExp): FileEntry[] {
	const entries: FileEntry[] = []

	// Match href and the text following it which contains date and size
	// Pattern: href="filename"   ...   SIZE
	const lines = html.split("\n")

	for (const line of lines) {
		// Match: href="something.zip" followed by size info
		const hrefMatch = line.match(/href="([^"]+)"/)
		if (!hrefMatch) continue

		const href = hrefMatch[1]
		if (!href || !archiveRegex.test(href)) continue

		const filename = decodeURIComponent(href)

		// Try to extract size from the same line
		// Myrient format: filename.zip</a>    01-Jan-2025 12:00    1.2M
		// Size is typically the last non-whitespace group
		const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s*([KMGT]?)\s*$/i)

		let size = 0
		if (sizeMatch && sizeMatch[1]) {
			const num = parseFloat(sizeMatch[1])
			const unit = (sizeMatch[2] ?? "").toUpperCase()

			switch (unit) {
				case "K":
					size = num * 1024
					break
				case "M":
					size = num * 1024 * 1024
					break
				case "G":
					size = num * 1024 * 1024 * 1024
					break
				case "T":
					size = num * 1024 * 1024 * 1024 * 1024
					break
				default:
					size = num // raw bytes
			}
		}

		entries.push({ filename, size: Math.round(size) })
	}

	return entries
}

/**
 * Parse size string (e.g., "1.2M", "500K") to bytes
 */
function parseSize(sizeStr: string): number {
	const match = sizeStr.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)$/i)
	if (!match || !match[1]) return 0

	const num = parseFloat(match[1])
	const unit = (match[2] ?? "").toUpperCase()

	switch (unit) {
		case "K":
			return num * 1024
		case "M":
			return num * 1024 * 1024
		case "G":
			return num * 1024 * 1024 * 1024
		case "T":
			return num * 1024 * 1024 * 1024 * 1024
		default:
			return num
	}
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatEta(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "--:--"
	const total = Math.round(seconds)
	const hrs = Math.floor(total / 3600)
	const mins = Math.floor((total % 3600) / 60)
	const secs = total % 60
	if (hrs > 0) {
		return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
			.toString()
			.padStart(2, "0")}`
	}
	return `${mins}:${secs.toString().padStart(2, "0")}`
}

/**
 * Download ROMs for a single entry with backpressure control
 *
 * Features:
 * - Backpressure: limits both concurrent downloads AND bytes-in-flight
 * - Size-aware: parses sizes from listing for accurate memory management
 * - Resume: uses .part files for crash recovery
 * - Streaming extraction: non-blocking ZIP extraction with yauzl
 */
export async function downloadRomEntry(
	entry: RomEntry,
	romsDir: string,
	options: DownloadOptions & {
		preset?: RegionPreset
		filter?: string
		includePrerelease: boolean
		includeUnlicensed: boolean
		diskProfile?: DiskProfile
	},
): Promise<DownloadResult> {
	const baseUrl = SOURCE_URLS[entry.source]
	const destDir = join(romsDir, entry.destDir)

	await mkdir(destDir, { recursive: true })

	if (options.dryRun) {
		ui.info(`[DRY-RUN] Would fetch ROM listing: ${entry.label}`)
		ui.debug(`Source: ${baseUrl}/${entry.remotePath}`, options.verbose)
		ui.debug(`Dest: ${destDir}`, options.verbose)
		return { label: `${entry.label} (dry-run)`, success: true }
	}

	ui.info(`Fetching listing for: ${entry.label}`)

	// Fetch directory listing with sizes
	let listing: FileEntry[]
	try {
		const response = await undiciFetch(`${baseUrl}/${entry.remotePath}`, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) retrosd-cli/1.0.0",
			},
			dispatcher: HTTP_AGENT,
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`)
		}

		const html = await response.text()
		listing = parseListing(html, entry.archiveRegex)
	} catch (err) {
		return {
			label: `${entry.label} [${entry.source}]`,
			success: false,
			error: `Failed to fetch listing: ${err instanceof Error ? err.message : String(err)}`,
		}
	}

	// Apply filters (on filenames)
	const regionFilter = options.preset
		? getPresetFilter(options.preset)
		: options.filter
			? parseCustomFilter(options.filter)
			: null

	const exclusionFilter = getExclusionFilter({
		includePrerelease: options.includePrerelease,
		includeUnlicensed: options.includeUnlicensed,
	})

	const filteredFilenames = applyFilters(
		listing.map(e => e.filename),
		{ regionFilter, exclusionFilter },
	)

	// Create a map for quick size lookup
	const sizeMap = new Map(listing.map(e => [e.filename, e.size]))
	const filteredListing = filteredFilenames.map(filename => ({
		filename,
		size: sizeMap.get(filename) ?? 0,
	}))

	const getExpectedSize = (filename: string): number =>
		sizeMap.get(filename) ?? 0

	ui.debug(
		`Listing: ${listing.length} files, after filter: ${filteredListing.length}`,
		options.verbose,
	)

	// Check which files need downloading
	let skippedExisting = 0
	let mismatchedExisting = 0
	const toDownload: FileEntry[] = []
	let totalBytes = 0

	for (const entry of filteredListing) {
		const baseNoExt = entry.filename.substring(
			0,
			entry.filename.lastIndexOf("."),
		)

		const archivePath = join(destDir, entry.filename)
		const hasArchive = existsSync(archivePath)
		const hasExtracted = anyExtensionExists(destDir, baseNoExt)

		if (hasArchive) {
			try {
				if (entry.size > 0) {
					const localSize = statSync(archivePath).size
					if (localSize === entry.size) {
						skippedExisting++
						continue
					}

					// Size mismatch – schedule re-download
					mismatchedExisting++
				} else {
					// Unknown remote size, trust existing archive
					skippedExisting++
					continue
				}
			} catch {
				// If we can't stat the file, fall through to re-download
			}
		}

		// If archive is gone but extracted files exist, trust the extracted copy
		if (!hasArchive && hasExtracted) {
			skippedExisting++
			continue
		}

		toDownload.push(entry)
		totalBytes += entry.size
	}

	if (toDownload.length === 0) {
		ui.success(
			`${entry.label}: nothing to download (skipped ${skippedExisting} existing)`,
		)
		return {
			label: `${entry.label} [${entry.source}]: skipped ${skippedExisting} existing`,
			success: true,
		}
	}

	// Select backpressure profile
	const profile = options.diskProfile ?? "balanced"
	const bpConfig = BACKPRESSURE_DEFAULTS[profile]

	ui.info(
		`${entry.label}: downloading ${toDownload.length} files ` +
			`(${formatBytes(totalBytes)}, ${skippedExisting} existing ok` +
			(mismatchedExisting > 0 ? `, ${mismatchedExisting} size-mismatch` : "") +
			`) [profile: ${profile}, max ${bpConfig.maxConcurrent} concurrent, ` +
			`${formatBytes(bpConfig.maxBytesInFlight)} max in-flight]`,
	)

	// Create backpressure controller
	const controller = new BackpressureController({
		...bpConfig,
		onStateChange: options.verbose
			? state => {
					ui.debug(
						`BP: ${state.activeTasks}/${state.maxConcurrent} tasks, ` +
							`${formatBytes(state.bytesInFlight)}/${formatBytes(state.maxBytesInFlight)} in-flight, ` +
							`${state.queuedTasks} queued`,
						true,
					)
				}
			: undefined,
	})

	// Download with backpressure
	const successFiles: string[] = []
	const failedFiles: Array<{ filename: string; error: string }> = []
	let completedCount = 0
	let bytesDownloaded = 0
	const startTime = Date.now()

	// Create download tasks
	const downloadTasks = toDownload.map(fileEntry => async () => {
		const { filename, size } = fileEntry
		const destPath = join(destDir, filename)
		const url = `${baseUrl}/${entry.remotePath}${encodeURIComponent(filename)}`

		// Acquire slot (will wait if at capacity)
		await controller.acquire(size)

		try {
			const result = await downloadFile(
				url,
				destPath,
				{
					retries: options.retryCount,
					delay: options.retryDelay,
					quiet: true,
					verbose: false,
				},
				size > 0 ? size : undefined,
			)

			if (result.success) {
				successFiles.push(filename)
				bytesDownloaded += result.bytesDownloaded
			} else {
				failedFiles.push({ filename, error: result.error ?? "Unknown error" })
			}

			return result
		} finally {
			// Always release, even on error
			controller.release(size, size)
			completedCount++

			// Progress update
			if (!options.quiet) {
				const pct = Math.round((completedCount / toDownload.length) * 100)
				const elapsedMs = Date.now() - startTime
				const speedBps =
					elapsedMs > 0 ? (bytesDownloaded * 1000) / elapsedMs : 0
				const speedText = speedBps > 0 ? ` @ ${formatBytes(speedBps)}/s` : ""
				const etaText =
					totalBytes > 0 && speedBps > 0
						? ` ETA ${formatEta(
								Math.max(0, (totalBytes - bytesDownloaded) / speedBps),
							)}`
						: ""
				process.stdout.write(
					`\r${entry.label}: ${completedCount}/${toDownload.length} (${pct}%) - ` +
						`${formatBytes(bytesDownloaded)} downloaded${speedText}${etaText}`,
				)
			}
		}
	})

	// Run all tasks (backpressure handles concurrency)
	await Promise.all(downloadTasks.map(task => task()))

	// Clear progress line
	if (!options.quiet) {
		process.stdout.write("\n")
	}

	// Extract archives if needed (streaming, non-blocking)
	if (entry.extract && successFiles.length > 0) {
		ui.info(`Extracting ${successFiles.length} archives...`)

		let extractedCount = 0
		let extractFailed = 0
		let recoveredCount = 0
		const extractConcurrency = Math.min(8, Math.max(2, options.jobs ?? 4))
		const limitExtract = pLimit(extractConcurrency)

		const extractTasks = successFiles.map(filename =>
			limitExtract(async () => {
				const archivePath = join(destDir, filename)
				const expectedSize = getExpectedSize(filename)
				const url = `${baseUrl}/${entry.remotePath}${encodeURIComponent(filename)}`

				if (existsSync(archivePath) && isZipArchive(filename)) {
					const attemptExtract = async (): Promise<boolean> => {
						const result = await extractZip(archivePath, destDir, {
							extractGlob: entry.extractGlob,
							deleteArchive: true, // Delete after successful extraction
							flatten: true, // Extract to root of destDir
						})

						if (result.success) {
							extractedCount++
							return true
						}

						ui.debug(
							`Extract failed for ${filename}: ${result.error ?? "unknown"}`,
							options.verbose,
						)
						return false
					}

					const initialOk = await attemptExtract()
					if (initialOk) return

					// Retry path: re-download then re-extract
					try {
						if (existsSync(archivePath)) {
							unlinkSync(archivePath)
						}
					} catch {
						// If unlink fails, continue to attempt re-download which will overwrite
					}

					const redownload = await downloadFile(
						url,
						archivePath,
						{
							retries: Math.max(2, options.retryCount),
							delay: options.retryDelay,
							quiet: true,
							verbose: false,
						},
						expectedSize > 0 ? expectedSize : undefined,
					)

					if (redownload.success) {
						const retryExtractOk = await attemptExtract()
						if (retryExtractOk) {
							recoveredCount++
							return
						}
					}

					extractFailed++
				}
			}),
		)

		await Promise.all(extractTasks)

		ui.debug(
			`Extracted: ${extractedCount}, recovered via redownload: ${recoveredCount}, failed: ${extractFailed} (concurrency ${extractConcurrency})`,
			options.verbose,
		)
	}

	const downloaded = successFiles.length
	const failed = failedFiles.length

	if (failed > 0) {
		ui.warn(
			`${entry.label}: ${downloaded} downloaded (${formatBytes(bytesDownloaded)}), ` +
				`${skippedExisting} skipped, ${failed} failed`,
		)
		return {
			label: `${entry.label} [${entry.source}]: ${downloaded} ok, ${skippedExisting} skipped, ${failed} failed`,
			success: false,
		}
	}

	ui.success(
		`${entry.label}: ${downloaded} downloaded (${formatBytes(bytesDownloaded)}), ${skippedExisting} skipped`,
	)
	return {
		label: `${entry.label} [${entry.source}]: ${downloaded} ok, ${skippedExisting} skipped`,
		success: true,
	}
}

/**
 * Download ROMs for multiple entries
 */
export async function downloadRoms(
	entries: RomEntry[],
	romsDir: string,
	options: DownloadOptions & {
		preset?: RegionPreset
		filter?: string
		includePrerelease: boolean
		includeUnlicensed: boolean
		diskProfile?: DiskProfile
	},
): Promise<Summary> {
	ui.header("Downloading ROMs")

	const results: DownloadResult[] = []

	for (const entry of entries) {
		const result = await downloadRomEntry(entry, romsDir, options)
		results.push(result)
	}

	const completed = results.filter(r => r.success)
	const failed = results.filter(r => !r.success)

	return { completed, failed }
}

/**
 * Create all required ROM directories
 */
export async function createRomDirectories(romsDir: string): Promise<void> {
	const dirs = [
		"FC",
		"GB",
		"GBA",
		"GBC",
		"MD",
		"MGBA",
		"PCE",
		"PKM",
		"PRBOOM",
		"PS",
		"PUAE",
		"SGB",
	]

	for (const dir of dirs) {
		await mkdir(join(romsDir, dir), { recursive: true })
	}
}
