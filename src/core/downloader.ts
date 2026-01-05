/**
 * Core Download Engine
 *
 * Pure business logic for ROM downloading using async generators.
 * Emits events that UI components can consume without any direct UI coupling.
 *
 * Key features:
 * - Backpressure control (bytes + concurrency limits)
 * - Range resume support via .part files
 * - 1G1R deduplication
 * - Region/language filtering
 */

import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import pLimit from "p-limit"
import { Agent, fetch as undiciFetch } from "undici"

import { BackpressureController } from "../backpressure.js"
import { downloadFile, anyExtensionExists, HTTP_AGENT } from "../download.js"
import { isZipArchive, extractZip } from "../extract.js"
import {
	applyFilters,
	apply1G1R,
	getPresetFilter,
	parseCustomFilter,
} from "../filters.js"
import {
	loadManifest,
	saveManifest,
	manifestKey,
	setManifestEntry,
	setManifestDirectoryLastModified,
	headRemoteMeta,
	parseListing,
	parseDirectoryLastModified,
	type ManifestFile,
	type FileEntry,
	type RemoteMeta,
} from "../roms.js"
import type { RomEntry, Source, DiskProfile } from "../types.js"
import type { DownloadEvent, DownloaderOptions } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_URLS: Record<Source, string> = {
	"no-intro": "https://myrient.erista.me/files/No-Intro",
	redump: "https://myrient.erista.me/files/Redump",
}

// ─────────────────────────────────────────────────────────────────────────────
// Backpressure Resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveBackpressure(
	profile: DiskProfile,
	jobs: number,
): { maxBytesInFlight: number; maxConcurrent: number } {
	switch (profile) {
		case "fast":
			return {
				maxBytesInFlight: 512 * 1024 * 1024, // 512MB
				maxConcurrent: Math.max(jobs, 16),
			}
		case "slow":
			return {
				maxBytesInFlight: 32 * 1024 * 1024, // 32MB
				maxConcurrent: Math.min(jobs, 4),
			}
		case "balanced":
		default:
			return {
				maxBytesInFlight: 128 * 1024 * 1024, // 128MB
				maxConcurrent: Math.min(jobs, 8),
			}
	}
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function normalizeLastModified(value: string | undefined): string | undefined {
	if (!value) return undefined
	const trimmed = value.trim()
	if (!trimmed || trimmed === "-") return undefined

	const ms = Date.parse(trimmed)
	if (!Number.isFinite(ms)) return undefined
	const dt = new Date(ms)
	if (Number.isNaN(dt.getTime())) return undefined
	return dt.toISOString()
}

// ─────────────────────────────────────────────────────────────────────────────
// Download Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async generator that yields download events.
 *
 * Usage:
 * ```ts
 * for await (const event of downloadRoms(options)) {
 *   switch (event.type) {
 *     case 'start': updateUI(event); break;
 *     case 'progress': updateProgress(event); break;
 *     case 'complete': markComplete(event); break;
 *   }
 * }
 * ```
 */
export async function* downloadRoms(
	options: DownloaderOptions,
): AsyncGenerator<DownloadEvent> {
	const { romsDir, entries } = options

	// Ensure base directory exists
	await mkdir(romsDir, { recursive: true })

	// Load manifest for resume/update tracking
	const manifest = loadManifest(romsDir)

	// Process each ROM entry
	for (const entry of entries) {
		yield* downloadRomEntry(entry, romsDir, options, manifest)
	}

	// Save manifest at end
	saveManifest(romsDir, manifest)
}

/**
 * Generator for downloading a single ROM entry (system)
 */
async function* downloadRomEntry(
	entry: RomEntry,
	romsDir: string,
	options: DownloaderOptions,
	manifest: ManifestFile,
): AsyncGenerator<DownloadEvent> {
	const baseUrl = SOURCE_URLS[entry.source]
	const destDir = join(romsDir, entry.destDir)

	await mkdir(destDir, { recursive: true })

	// Dry run handling
	if (options.dryRun) {
		yield {
			type: "listing",
			system: entry.key,
			label: entry.label,
			source: entry.source,
		}

		yield {
			type: "filtered",
			system: entry.key,
			label: entry.label,
			total: 0,
			toDownload: 0,
			skipped: 0,
			totalBytes: 0,
		}

		yield {
			type: "batch-complete",
			system: entry.key,
			label: entry.label,
			success: 0,
			failed: 0,
			skipped: 0,
			bytesDownloaded: 0,
			durationMs: 0,
		}
		return
	}

	// Emit listing event
	yield {
		type: "listing",
		system: entry.key,
		label: entry.label,
		source: entry.source,
	}

	// Fetch directory listing with sizes
	let listing: FileEntry[]
	let directoryLastModified: string | undefined
	let effectiveUpdate = options.update

	try {
		const response = await undiciFetch(`${baseUrl}/${entry.remotePath}`, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) retrosd-cli/1.0.0",
			},
			dispatcher: HTTP_AGENT,
		})

		if (!response.ok) {
			yield {
				type: "error",
				id: `listing-${entry.key}`,
				filename: "",
				system: entry.key,
				error: `HTTP ${response.status}`,
				retryable: response.status >= 500,
			}
			return
		}

		const html = await response.text()
		directoryLastModified = parseDirectoryLastModified(html)

		// Check if directory unchanged (optimization)
		const previousDirLastModified =
			manifest.directories?.[entry.key]?.lastModified
		if (
			options.update &&
			directoryLastModified &&
			previousDirLastModified &&
			directoryLastModified === previousDirLastModified
		) {
			effectiveUpdate = false
		}

		listing = parseListing(html, entry.archiveRegex)

		if (directoryLastModified) {
			setManifestDirectoryLastModified(
				manifest,
				entry.key,
				directoryLastModified,
			)
		}
	} catch (err) {
		yield {
			type: "error",
			id: `listing-${entry.key}`,
			filename: "",
			system: entry.key,
			error: `Failed to fetch listing: ${err instanceof Error ? err.message : String(err)}`,
			retryable: true,
		}
		return
	}

	// Apply filters
	let nameFilter: RegExp | null = null
	try {
		nameFilter = options.preset
			? getPresetFilter(options.preset)
			: options.filter
				? parseCustomFilter(options.filter)
				: null
	} catch (err) {
		yield {
			type: "error",
			id: `filter-${entry.key}`,
			filename: "",
			system: entry.key,
			error: `Invalid filter: ${err instanceof Error ? err.message : String(err)}`,
			retryable: false,
		}
		return
	}

	const filteredFilenames = applyFilters(
		listing.map(e => e.filename),
		{
			nameFilter,
			exclusion: {
				includePrerelease: options.includePrerelease ?? false,
				includeUnlicensed: options.includeUnlicensed ?? false,
				includeHacks: options.includeHacks ?? false,
				includeHomebrew: options.includeHomebrew ?? false,
			},
			...(options.inferLanguageCodes !== undefined
				? { inferLanguageCodes: options.inferLanguageCodes }
				: {}),
			...(options.includeRegionCodes?.length
				? { includeRegionCodes: options.includeRegionCodes }
				: {}),
			...(options.excludeRegionCodes?.length
				? { excludeRegionCodes: options.excludeRegionCodes }
				: {}),
			...(options.includeLanguageCodes?.length
				? { includeLanguageCodes: options.includeLanguageCodes }
				: {}),
			...(options.excludeLanguageCodes?.length
				? { excludeLanguageCodes: options.excludeLanguageCodes }
				: {}),
			...(options.includePatterns?.length
				? { includePatterns: options.includePatterns }
				: {}),
			...(options.excludePatterns?.length
				? { excludePatterns: options.excludePatterns }
				: {}),
			...(options.includeList ? { includeList: options.includeList } : {}),
			...(options.excludeList ? { excludeList: options.excludeList } : {}),
		},
	)

	// Apply 1G1R deduplication
	const enable1G1R = options.enable1G1R ?? true
	const finalFilenames = enable1G1R
		? apply1G1R(filteredFilenames, {
				...(options.preferredRegion
					? { preferredRegion: options.preferredRegion }
					: {}),
				...(options.regionPriority
					? { regionPriority: options.regionPriority }
					: {}),
				...(options.preferredLanguage
					? { preferredLanguage: options.preferredLanguage }
					: {}),
				...(options.languagePriority
					? { languagePriority: options.languagePriority }
					: {}),
			})
		: filteredFilenames

	// Build maps for quick lookups
	const sizeMap = new Map(listing.map(e => [e.filename, e.size]))
	const lastModifiedMap = new Map(
		listing.map(e => [e.filename, e.lastModified]),
	)

	// Determine what needs downloading
	let skippedExisting = 0
	const toDownload: Array<{
		file: FileEntry
		meta: RemoteMeta | null
		estimatedBytes: number
		expectedSize?: number
	}> = []
	let totalBytes = 0

	for (const filename of finalFilenames) {
		const baseNoExt = filename.substring(0, filename.lastIndexOf("."))
		const archivePath = join(destDir, filename)
		const hasArchive = existsSync(archivePath)
		const hasExtracted = anyExtensionExists(destDir, baseNoExt)
		const key = manifestKey(entry.destDir, filename)
		const manifestEntry = manifest.entries[key]

		const remoteSize = sizeMap.get(filename) ?? 0
		const listingLastModified = lastModifiedMap.get(filename)

		let remoteMeta: RemoteMeta | null = null
		if (remoteSize > 0 || listingLastModified) {
			remoteMeta = {
				...(remoteSize > 0 ? { size: remoteSize } : {}),
				...(listingLastModified ? { lastModified: listingLastModified } : {}),
			}
		}

		let shouldDownload = !hasArchive && !hasExtracted
		let localSize = 0
		if (hasArchive) {
			try {
				localSize = statSync(archivePath).size
			} catch {
				localSize = 0
			}
		}

		if (!shouldDownload) {
			if (effectiveUpdate) {
				const sizeChanged =
					(remoteSize > 0 && localSize > 0 && remoteSize !== localSize) ||
					(remoteSize > 0 &&
						!hasArchive &&
						manifestEntry?.size &&
						remoteSize !== manifestEntry.size)

				const remoteLastModified = normalizeLastModified(
					remoteMeta?.lastModified,
				)
				const localLastModified = normalizeLastModified(
					manifestEntry?.lastModified,
				)
				const lastModifiedChanged =
					remoteLastModified && localLastModified
						? remoteLastModified !== localLastModified
						: false

				shouldDownload = sizeChanged || lastModifiedChanged
				if (!shouldDownload) {
					skippedExisting++
				}
			} else {
				skippedExisting++
			}
		}

		if (shouldDownload) {
			const expectedSize = remoteSize > 0 ? remoteSize : undefined
			const estimatedBytes = expectedSize ?? 8 * 1024 * 1024
			toDownload.push({
				file: {
					filename,
					size: remoteSize,
					...(listingLastModified ? { lastModified: listingLastModified } : {}),
				},
				meta: remoteMeta,
				estimatedBytes,
				...(expectedSize !== undefined ? { expectedSize } : {}),
			})
			totalBytes += estimatedBytes
		} else if (remoteMeta) {
			// Update manifest for skipped files
			setManifestEntry(manifest, entry.destDir, filename, remoteMeta)
		}
	}

	// Emit filtered event
	yield {
		type: "filtered",
		system: entry.key,
		label: entry.label,
		total: listing.length,
		toDownload: toDownload.length,
		skipped: skippedExisting,
		totalBytes,
	}

	if (toDownload.length === 0) {
		yield {
			type: "batch-complete",
			system: entry.key,
			label: entry.label,
			success: 0,
			failed: 0,
			skipped: skippedExisting,
			bytesDownloaded: 0,
			durationMs: 0,
		}
		return
	}

	// Emit batch start
	yield {
		type: "batch-start",
		system: entry.key,
		label: entry.label,
		count: toDownload.length,
		totalBytes,
	}

	// Setup backpressure
	const profile = options.diskProfile ?? "balanced"
	const bpConfig = resolveBackpressure(profile, options.jobs)
	const controller = new BackpressureController(bpConfig)

	// Download tracking
	const successFiles: string[] = []
	const failedFiles: Array<{ filename: string; error: string }> = []
	let bytesDownloaded = 0
	const startTime = Date.now()

	// Create a queue for yielding events from concurrent downloads
	const eventQueue: DownloadEvent[] = []
	let resolveQueue: (() => void) | null = null

	const pushEvent = (event: DownloadEvent) => {
		eventQueue.push(event)
		if (resolveQueue) {
			resolveQueue()
			resolveQueue = null
		}
	}

	// Download tasks
	const limit = pLimit(bpConfig.maxConcurrent)
	const downloadPromises = toDownload.map(item =>
		limit(async () => {
			const { filename } = item.file
			const destPath = join(destDir, filename)
			const url = `${baseUrl}/${entry.remotePath}${encodeURIComponent(filename)}`
			const estimatedBytes = item.estimatedBytes
			const expectedSize = item.expectedSize

			await controller.acquire(estimatedBytes)

			const downloadId = `${entry.key}-${filename}`

			pushEvent({
				type: "start",
				id: downloadId,
				filename,
				system: entry.key,
				...(expectedSize !== undefined ? { expectedSize } : {}),
			})

			try {
				const result = await downloadFile(
					url,
					destPath,
					{
						retries: options.retryCount,
						delay: options.retryDelay,
						quiet: true,
						verbose: false,
						onProgress: (current, total, speed) => {
							pushEvent({
								type: "progress",
								id: downloadId,
								filename,
								system: entry.key,
								current,
								total,
								speed,
								percent: total > 0 ? Math.round((current / total) * 100) : 0,
							})
						},
					},
					expectedSize,
				)

				if (result.success) {
					successFiles.push(filename)
					bytesDownloaded += result.bytesDownloaded

					const meta =
						item.meta ?? (expectedSize ? { size: expectedSize } : null)
					if (meta) {
						setManifestEntry(manifest, entry.destDir, filename, meta)
					}

					pushEvent({
						type: "complete",
						id: downloadId,
						filename,
						system: entry.key,
						bytesDownloaded: result.bytesDownloaded,
						localPath: destPath,
					})
				} else {
					failedFiles.push({ filename, error: result.error ?? "Unknown error" })
					pushEvent({
						type: "error",
						id: downloadId,
						filename,
						system: entry.key,
						error: result.error ?? "Unknown error",
						retryable: true,
					})
				}
			} finally {
				controller.release(estimatedBytes, estimatedBytes)
			}
		}),
	)

	// Process events while downloads run
	const allDone = Promise.all(downloadPromises)
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

	// Extraction phase
	if (entry.extract && successFiles.length > 0) {
		let extractedCount = 0
		let extractFailed = 0
		const extractLimit = pLimit(Math.min(8, options.jobs))

		const extractPromises = successFiles.map(filename =>
			extractLimit(async () => {
				const archivePath = join(destDir, filename)
				const downloadId = `${entry.key}-${filename}`

				if (!existsSync(archivePath) || !isZipArchive(filename)) {
					return
				}

				pushEvent({
					type: "extract",
					id: downloadId,
					filename,
					system: entry.key,
					status: "start",
				})

				const result = await extractZip(archivePath, destDir, {
					extractGlob: entry.extractGlob,
					deleteArchive: true,
					flatten: true,
				})

				if (result.success) {
					extractedCount++
					pushEvent({
						type: "extract",
						id: downloadId,
						filename,
						system: entry.key,
						status: "complete",
					})
				} else {
					extractFailed++
					pushEvent({
						type: "extract",
						id: downloadId,
						filename,
						system: entry.key,
						status: "error",
						...(result.error ? { error: result.error } : {}),
					})
				}
			}),
		)

		const extractDone = Promise.all(extractPromises)
		let extractFinished = false
		void extractDone.then(() => {
			extractFinished = true
			if (resolveQueue) resolveQueue()
		})

		while (!extractFinished || eventQueue.length > 0) {
			if (eventQueue.length > 0) {
				yield eventQueue.shift()!
			} else if (!extractFinished) {
				await new Promise<void>(resolve => {
					resolveQueue = resolve
				})
			}
		}
	}

	const durationMs = Date.now() - startTime

	yield {
		type: "batch-complete",
		system: entry.key,
		label: entry.label,
		success: successFiles.length,
		failed: failedFiles.length,
		skipped: skippedExisting,
		bytesDownloaded,
		durationMs,
	}

	// Save manifest after each system
	saveManifest(romsDir, manifest)
}

// Re-export helper types
export type { DownloadEvent, DownloaderOptions } from "./types.js"
