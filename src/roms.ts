/**
 * ROM source definitions and download logic
 *
 * Implementation highlights:
 * - Backpressure control (bytes + concurrency limits)
 * - File size + last-modified parsing from directory listings
 * - Range resume support via .part files
 * - Streaming ZIP extraction with yauzl
 * - Adaptive concurrency for different disk speeds
 */

import { mkdir } from "node:fs/promises"
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
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
import { writeFileSync, readFileSync } from "node:fs"
import { runParallel } from "./parallel.js"
import { createProgressTracker } from "./progress.js"

function resolveBackpressure(
	profile: DiskProfile,
	jobs: number,
): { maxBytesInFlight: number; maxConcurrent: number } {
	const base = BACKPRESSURE_DEFAULTS[profile]
	const targetConcurrent = Math.max(1, Math.min(32, jobs || base.maxConcurrent))
	const bytesPerTask = base.maxBytesInFlight / base.maxConcurrent
	const maxBytesInFlight = Math.max(
		bytesPerTask * targetConcurrent,
		bytesPerTask * 2,
	)
	return {
		maxBytesInFlight,
		maxConcurrent: targetConcurrent,
	}
}

/**
 * Parsed file entry with size information
 */
interface FileEntry {
	filename: string
	size: number // bytes, 0 if unknown
	lastModified?: string // ISO string if parseable
}

interface RemoteMeta {
	size?: number
	etag?: string
	lastModified?: string
}

interface ManifestEntry {
	filename: string
	size?: number
	etag?: string
	lastModified?: string
	updatedAt: string
}

interface ManifestFile {
	version: number
	entries: Record<string, ManifestEntry>
	directories?: Record<string, { lastModified?: string; updatedAt: string }>
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

const MANIFEST_FILE = ".retrosd-manifest.json"

function manifestKey(destDir: string, filename: string): string {
	return `${destDir}/${filename}`
}

function loadManifest(romsDir: string): ManifestFile {
	try {
		const raw = readFileSync(join(romsDir, MANIFEST_FILE), "utf8")
		const parsed = JSON.parse(raw) as ManifestFile
		if (parsed && parsed.version === 1 && parsed.entries) {
			return {
				version: 1,
				entries: parsed.entries,
				directories: parsed.directories ?? {},
			}
		}
	} catch {
		// Fresh manifest
	}

	return { version: 1, entries: {}, directories: {} }
}

function saveManifest(romsDir: string, manifest: ManifestFile): void {
	try {
		writeFileSync(
			join(romsDir, MANIFEST_FILE),
			JSON.stringify(manifest, null, 2),
			"utf8",
		)
	} catch {
		// Best-effort; do not fail downloads if manifest write fails
	}
}

function setManifestEntry(
	manifest: ManifestFile,
	destDir: string,
	filename: string,
	meta: RemoteMeta | null,
): void {
	const key = manifestKey(destDir, filename)
	const entry: ManifestEntry = {
		filename,
		updatedAt: new Date().toISOString(),
	}
	if (meta?.size !== undefined) entry.size = meta.size
	if (meta?.etag !== undefined) entry.etag = meta.etag
	if (meta?.lastModified !== undefined) entry.lastModified = meta.lastModified
	manifest.entries[key] = entry
}

function setManifestDirectoryLastModified(
	manifest: ManifestFile,
	entryKey: string,
	lastModified: string | undefined,
): void {
	if (!manifest.directories) manifest.directories = {}
	const record: { lastModified?: string; updatedAt: string } = {
		updatedAt: new Date().toISOString(),
	}
	if (lastModified !== undefined) record.lastModified = lastModified
	manifest.directories[entryKey] = record
}

async function headRemoteMeta(url: string): Promise<RemoteMeta | null> {
	try {
		const res = await undiciFetch(url, {
			method: "HEAD",
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) retrosd-cli/1.0.0",
			},
			dispatcher: HTTP_AGENT,
		})

		if (!res.ok) return null

		const sizeHeader = res.headers.get("content-length")
		const etagHeader = res.headers.get("etag")
		const lastModifiedRaw = res.headers.get("last-modified")
		const lastModified = normalizeLastModified(lastModifiedRaw ?? undefined)

		const size = sizeHeader ? parseInt(sizeHeader, 10) : undefined
		const meta: RemoteMeta = {}
		if (Number.isFinite(size) && size !== undefined) meta.size = size
		if (etagHeader !== null) meta.etag = etagHeader
		if (lastModified !== undefined) meta.lastModified = lastModified
		return Object.keys(meta).length > 0 ? meta : null
	} catch {
		return null
	}
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

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

function parseMyrientLastModified(value: string): string | undefined {
	const trimmed = value.trim()
	if (!trimmed || trimmed === "-") return undefined

	// Common Myrient format: "04-Jan-2023 09:01"
	const match = trimmed.match(
		/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/,
	)
	if (!match) return undefined

	const day = parseInt(match[1] ?? "", 10)
	const monthAbbr = (match[2] ?? "").toLowerCase()
	const year = parseInt(match[3] ?? "", 10)
	const hour = parseInt(match[4] ?? "", 10)
	const minute = parseInt(match[5] ?? "", 10)
	const second = parseInt(match[6] ?? "0", 10)

	const monthIndexMap: Record<string, number> = {
		jan: 0,
		feb: 1,
		mar: 2,
		apr: 3,
		may: 4,
		jun: 5,
		jul: 6,
		aug: 7,
		sep: 8,
		oct: 9,
		nov: 10,
		dec: 11,
	}
	const monthIndex = monthIndexMap[monthAbbr]
	if (!Number.isFinite(monthIndex)) return undefined

	if (
		![day, year, hour, minute, second].every(n => Number.isFinite(n) && n >= 0)
	) {
		return undefined
	}

	const ms = Date.UTC(year, monthIndex, day, hour, minute, second)
	const dt = new Date(ms)
	if (Number.isNaN(dt.getTime())) return undefined
	return dt.toISOString()
}

function normalizeLastModified(value: string | undefined): string | undefined {
	if (!value) return undefined
	const trimmed = value.trim()
	if (!trimmed || trimmed === "-") return undefined

	const myrient = parseMyrientLastModified(trimmed)
	if (myrient) return myrient

	const ms = Date.parse(trimmed)
	if (!Number.isFinite(ms)) return undefined
	const dt = new Date(ms)
	if (Number.isNaN(dt.getTime())) return undefined
	return dt.toISOString()
}

function parseDirectoryLastModified(html: string): string | undefined {
	// Look for the "./" row, which Myrient uses to show the directory's last update
	const tableRow = html.match(
		/<tr[^>]*>\s*<td[^>]*>\s*<a\s+href="\.\/"[^>]*>\.?\/?<\/a>\s*<\/td>\s*<td[^>]*>\s*[^<]*\s*<\/td>\s*<td[^>]*>\s*([^<]*)\s*<\/td>/im,
	)
	if (tableRow && tableRow[1]) {
		return parseMyrientLastModified(tableRow[1])
	}

	const pipeRow = html.match(/^\|\s*\.\/?\s*\|\s*-\s*\|\s*([^|]+?)\s*\|/im)
	if (pipeRow && pipeRow[1]) {
		return parseMyrientLastModified(pipeRow[1])
	}

	return undefined
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

	const pushRow = (href: string, sizeCell: string, lmCell: string): void => {
		if (!href) return
		if (href === "../" || href === "./" || href === ".." || href === ".") return
		if (href.endsWith("/")) return

		const filename = safeDecodeURIComponent(href)
		if (!archiveRegex.test(filename)) return

		const sizeText = sizeCell.trim()
		const size = sizeText === "-" ? 0 : Math.round(parseSize(sizeText))
		const lastModified = parseMyrientLastModified(lmCell)
		const entry: FileEntry = { filename, size }
		if (lastModified !== undefined) entry.lastModified = lastModified
		entries.push(entry)
	}

	// Myrient listings are typically HTML tables:
	// <tr><td><a href="file.zip">file.zip</a></td><td>35.9 KiB</td><td>04-Jan-2023 09:01</td></tr>
	const tableRowRegex =
		/<tr[^>]*>\s*<td[^>]*>\s*<a\s+href="([^"]+)"[^>]*>[^<]+<\/a>\s*<\/td>\s*<td[^>]*>\s*([^<]*)\s*<\/td>\s*<td[^>]*>\s*([^<]*)\s*<\/td>/gim
	let match: RegExpExecArray | null
	while ((match = tableRowRegex.exec(html)) !== null) {
		pushRow(match[1] ?? "", match[2] ?? "", match[3] ?? "")
	}

	// Fallback: line-by-line parse for legacy indexes
	if (entries.length === 0) {
		// Some renderers show the listing as a pipe table:
		// | file.zip | 35.9 KiB | 04-Jan-2023 09:01 |
		const pipeRowRegex =
			/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gim
		while ((match = pipeRowRegex.exec(html)) !== null) {
			const name = (match[1] ?? "").trim()
			if (!name || name.endsWith("/")) continue
			pushRow(name, match[2] ?? "", match[3] ?? "")
		}

		if (entries.length === 0) {
			const lines = html.split("\n")
			for (const line of lines) {
				const hrefMatch = line.match(/href="([^"]+)"/)
				if (!hrefMatch) continue
				const href = hrefMatch[1] ?? ""
				if (!href || href.endsWith("/")) continue
				const filename = safeDecodeURIComponent(href)
				if (!archiveRegex.test(filename)) continue
				const sizeMatch = line.match(/(\d[\d.,]*\s*[KMGT]i?B?)/i)
				const lmMatch =
					line.match(/(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/) ??
					null
				const out: FileEntry = {
					filename,
					size: Math.round(sizeMatch ? parseSize(sizeMatch[1] ?? "") : 0),
				}
				const lm = lmMatch
					? parseMyrientLastModified(lmMatch[1] ?? "")
					: undefined
				if (lm !== undefined) out.lastModified = lm
				entries.push(out)
			}
		}
	}

	return entries
}

/**
 * Parse size string (e.g., "1.2M", "500K") to bytes
 */
function parseSize(sizeStr: string): number {
	const trimmed = sizeStr.trim()
	if (!trimmed || trimmed === "-") return 0

	const match = trimmed.match(/^(\d[\d.,]*)(?:\s*([A-Za-z]+))?$/)
	if (!match || !match[1]) return 0

	const num = parseFloat(match[1].replace(/,/g, ""))
	if (!Number.isFinite(num)) return 0

	const rawUnit = (match[2] ?? "").toLowerCase()
	const unit = rawUnit.replace(/\s+/g, "")

	switch (unit) {
		case "":
		case "b":
		case "bytes":
			return num
		case "k":
		case "kb":
		case "kib":
			return num * 1024
		case "m":
		case "mb":
		case "mib":
			return num * 1024 * 1024
		case "g":
		case "gb":
		case "gib":
			return num * 1024 * 1024 * 1024
		case "t":
		case "tb":
		case "tib":
			return num * 1024 * 1024 * 1024 * 1024
		default:
			// Handle "KiB" etc that may include a trailing "b" already
			if (unit.endsWith("ib")) {
				const base = unit[0]
				return parseSize(`${match[1]} ${base}`)
			}
			return 0
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
		update: boolean
		manifest: ManifestFile
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
			throw new Error(`HTTP ${response.status}`)
		}

		const html = await response.text()
		directoryLastModified = parseDirectoryLastModified(html)
		const previousDirLastModified =
			options.manifest.directories?.[entry.key]?.lastModified
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
				options.manifest,
				entry.key,
				directoryLastModified,
			)
		}
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
	const lastModifiedMap = new Map(
		listing.map(e => [e.filename, e.lastModified]),
	)
	const filteredListing = filteredFilenames.map(filename => {
		const lastModified = lastModifiedMap.get(filename)
		const out: FileEntry = { filename, size: sizeMap.get(filename) ?? 0 }
		if (lastModified !== undefined) out.lastModified = lastModified
		return out
	})

	const getExpectedSize = (filename: string): number =>
		sizeMap.get(filename) ?? 0

	ui.debug(
		`Listing: ${listing.length} files, after filter: ${filteredListing.length}`,
		options.verbose,
	)

	// Check which files need downloading
	let skippedExisting = 0
	let mismatchedExisting = 0
	const toDownload: Array<{
		file: FileEntry
		meta: RemoteMeta | null
		estimatedBytes: number
		expectedSize?: number
	}> = []
	let totalBytes = 0

	for (const fileEntry of filteredListing) {
		const { filename } = fileEntry
		const baseNoExt = filename.substring(0, filename.lastIndexOf("."))
		const archivePath = join(destDir, filename)
		const hasArchive = existsSync(archivePath)
		const hasExtracted = anyExtensionExists(destDir, baseNoExt)
		const key = manifestKey(entry.destDir, filename)
		const manifestEntry = options.manifest.entries[key]
		const url = `${baseUrl}/${entry.remotePath}${encodeURIComponent(filename)}`

		let remoteMeta: RemoteMeta | null = null
		let remoteSize = fileEntry.size
		const listingLastModified = fileEntry.lastModified

		if (remoteSize > 0 || listingLastModified) {
			remoteMeta = {
				...(remoteSize > 0 ? { size: remoteSize } : {}),
				...(listingLastModified ? { lastModified: listingLastModified } : {}),
			}
		}

		// Prefer listing metadata (fast). Only fall back to HEAD when update checks
		// require metadata that's missing from the listing.
		if (
			effectiveUpdate &&
			(hasArchive || hasExtracted || manifestEntry) &&
			(!listingLastModified || remoteSize === 0)
		) {
			const headMeta = await headRemoteMeta(url)
			if (headMeta) {
				remoteMeta = {
					...remoteMeta,
					...headMeta,
				}
			}
			if (remoteMeta?.size && Number.isFinite(remoteMeta.size)) {
				remoteSize = remoteMeta.size
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
				// Update logic prefers listing-provided last-modified. Manifest is used as
				// the local reference point (especially when archives are deleted after extraction).
				const sizeChanged =
					(remoteSize > 0 && localSize > 0 && remoteSize !== localSize) ||
					(remoteSize > 0 &&
						!hasArchive &&
						manifestEntry?.size &&
						remoteSize !== manifestEntry.size)

				const etagChanged =
					remoteMeta?.etag && manifestEntry?.etag
						? remoteMeta.etag !== manifestEntry.etag
						: false

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

				// If manifest is missing but we have local content, treat as up-to-date
				// and record listing metadata for future update checks.
				shouldDownload = sizeChanged || etagChanged || lastModifiedChanged
				if (!shouldDownload) {
					skippedExisting++
				}
			} else if (hasArchive) {
				// In non-update mode (resume), skip all existing files regardless of size
				// Size mismatches should only trigger redownload when --update is used
				if (fileEntry.size > 0 && localSize !== fileEntry.size) {
					mismatchedExisting++
				}
				skippedExisting++
			} else if (!hasArchive && hasExtracted) {
				skippedExisting++
			}
		}

		if (shouldDownload) {
			const expectedSize = remoteSize > 0 ? remoteSize : undefined
			const estimatedBytes = expectedSize ?? 8 * 1024 * 1024 // reserve 8MB when unknown
			toDownload.push({
				file: {
					filename: fileEntry.filename,
					size: remoteSize,
					...(fileEntry.lastModified !== undefined
						? { lastModified: fileEntry.lastModified }
						: {}),
				},
				meta: remoteMeta,
				estimatedBytes,
				...(expectedSize !== undefined ? { expectedSize } : {}),
			})
			totalBytes += estimatedBytes
		} else {
			const inferredMeta =
				remoteMeta ??
				(remoteSize > 0 || listingLastModified
					? {
							...(remoteSize > 0 ? { size: remoteSize } : {}),
							...(listingLastModified
								? { lastModified: listingLastModified }
								: {}),
						}
					: undefined)
			if (inferredMeta) {
				setManifestEntry(
					options.manifest,
					entry.destDir,
					filename,
					inferredMeta,
				)
			}
		}
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

	// Select backpressure profile (honor user jobs)
	const profile = options.diskProfile ?? "balanced"
	const bpConfig = resolveBackpressure(profile, options.jobs)

	ui.info(
		`${entry.label}: ${toDownload.length} files to download (${formatBytes(totalBytes)})` +
			(skippedExisting > 0 ? ` • ${skippedExisting} already exist` : "") +
			(mismatchedExisting > 0 && !effectiveUpdate
				? ` • ${mismatchedExisting} size mismatches (use --update to redownload)`
				: ""),
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

	// Create progress tracker for this ROM entry
	const progressTracker = createProgressTracker(entry.label, options.quiet)

	// Download with backpressure
	const successFiles: string[] = []
	const failedFiles: Array<{ filename: string; error: string }> = []
	let completedCount = 0
	let bytesDownloaded = 0
	const startTime = Date.now()

	// Create download tasks
	const downloadTasks = toDownload.map(item => async () => {
		const { filename } = item.file
		const destPath = join(destDir, filename)
		const url = `${baseUrl}/${entry.remotePath}${encodeURIComponent(filename)}`
		const estimatedBytes = item.estimatedBytes
		const expectedSize = item.expectedSize

		// Acquire slot (will wait if at capacity)
		await controller.acquire(estimatedBytes)

		// Start progress tracking for this download
		const downloadId = `${entry.key}-${filename}`
		if (expectedSize) {
			progressTracker.startDownload(downloadId, filename, expectedSize)
		}

		try {
			const downloadOptions: {
				retries: number
				delay: number
				quiet: boolean
				verbose: boolean
				onProgress?: (current: number, total: number, speed: number) => void
			} = {
				retries: options.retryCount,
				delay: options.retryDelay,
				quiet: true,
				verbose: false,
			}

			if (expectedSize) {
				downloadOptions.onProgress = (current, total, speed) => {
					progressTracker.updateDownload(downloadId, current, speed)
				}
			}

			const result = await downloadFile(
				url,
				destPath,
				downloadOptions,
				expectedSize,
			)

			if (result.success) {
				successFiles.push(filename)
				bytesDownloaded += result.bytesDownloaded
				const meta = item.meta ?? (expectedSize ? { size: expectedSize } : null)
				if (meta) {
					setManifestEntry(options.manifest, entry.destDir, filename, meta)
				}
				progressTracker.completeDownload(downloadId, true)
			} else {
				failedFiles.push({ filename, error: result.error ?? "Unknown error" })
				progressTracker.completeDownload(downloadId, false)
			}

			return result
		} finally {
			// Always release, even on error
			controller.release(estimatedBytes, estimatedBytes)
			completedCount++

			// Update overall progress
			const elapsedMs = Date.now() - startTime
			const speedBps = elapsedMs > 0 ? (bytesDownloaded * 1000) / elapsedMs : 0
			progressTracker.updateOverall(bytesDownloaded, totalBytes, speedBps)
		}
	})

	// Run all tasks (backpressure handles concurrency)
	await Promise.all(downloadTasks.map(task => task()))

	// Stop progress tracker
	progressTracker.stop()

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
		update: boolean
	},
): Promise<Summary> {
	ui.header("Downloading ROMs")

	const manifest = loadManifest(romsDir)
	const results: DownloadResult[] = []

	// Allow limited parallelism across systems to keep disks busy without thrashing
	const systemConcurrency = Math.max(
		1,
		Math.min(entries.length, Math.max(1, Math.floor((options.jobs ?? 4) / 2))),
	)

	const runner = async (entry: RomEntry, _index: number): Promise<void> => {
		const result = await downloadRomEntry(entry, romsDir, {
			...options,
			manifest,
		})
		results.push(result)
	}

	await runParallel(entries, runner, {
		concurrency: systemConcurrency,
		label: "ROM systems",
		quiet: options.quiet,
		noSpinner: true, // Each entry shows its own download progress
	})

	saveManifest(romsDir, manifest)

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
