/**
 * ROM metadata management
 * Generates and manages .json sidecar files for ROM library integration
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { FileHash } from "./hash.js"
import { parseRomFilenameParts } from "./romname.js"

export interface RomMetadata {
	/** Display title */
	title: string
	/** Filename without extension */
	filename: string
	/** Full filename with extension */
	fullFilename: string
	/** System/platform */
	system: string
	/** Region(s) */
	region: string[]
	/** Release info (Rev, v1.1, etc.) */
	version?: string
	/** Additional tags (Beta, Demo, Proto, etc.) */
	tags: string[]
	/** Source repository */
	source: "no-intro" | "redump"
	/** DAT file version if known */
	datVersion?: string
	/** File hashes */
	hash?: FileHash
	/** Local file size when metadata was last updated (for incremental hashing) */
	fileSize?: number
	/** Local file mtimeMs when metadata was last updated (for incremental hashing) */
	fileMtimeMs?: number
	/** When this metadata was generated */
	createdAt: string
	/** When this metadata was last updated */
	updatedAt: string
}

/**
 * Parse ROM filename into structured metadata
 * Handles common naming conventions from No-Intro and Redump
 */
export function parseRomFilename(
	filename: string,
	system: string,
	source: "no-intro" | "redump",
): Omit<RomMetadata, "hash" | "createdAt" | "updatedAt"> {
	const parsed = parseRomFilenameParts(filename)
	const nameWithoutExt = parsed.baseName
	const fullFilename = filename

	return {
		title: parsed.title,
		filename: nameWithoutExt,
		fullFilename,
		system,
		region: parsed.regions,
		...(parsed.version ? { version: parsed.version } : {}),
		tags: parsed.tags,
		source,
	}
}

/**
 * Generate metadata file for a ROM
 */
export function generateMetadata(
	filename: string,
	system: string,
	source: "no-intro" | "redump",
	hash?: FileHash,
	datVersion?: string,
): RomMetadata {
	const parsed = parseRomFilename(filename, system, source)
	const now = new Date().toISOString()

	return {
		...parsed,
		...(hash ? { hash } : {}),
		...(datVersion ? { datVersion } : {}),
		createdAt: now,
		updatedAt: now,
	}
}

/**
 * Save metadata to sidecar JSON file
 */
export function saveMetadata(
	destDir: string,
	filename: string,
	metadata: RomMetadata,
): void {
	const metadataPath = join(destDir, filename.replace(/\.[^.]+$/, "") + ".json")
	writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8")
}

/**
 * Load metadata from sidecar JSON file
 */
export function loadMetadata(
	destDir: string,
	filename: string,
): RomMetadata | null {
	const metadataPath = join(destDir, filename.replace(/\.[^.]+$/, "") + ".json")

	if (!existsSync(metadataPath)) {
		return null
	}

	try {
		const data = readFileSync(metadataPath, "utf8")
		return JSON.parse(data) as RomMetadata
	} catch {
		return null
	}
}

/**
 * Update existing metadata with new hash information
 */
export function updateMetadataHash(
	destDir: string,
	filename: string,
	hash: FileHash,
	fingerprint?: { fileSize: number; fileMtimeMs: number },
): boolean {
	const existing = loadMetadata(destDir, filename)
	if (!existing) {
		return false
	}

	existing.hash = hash
	if (fingerprint) {
		existing.fileSize = fingerprint.fileSize
		existing.fileMtimeMs = fingerprint.fileMtimeMs
	}
	existing.updatedAt = new Date().toISOString()
	saveMetadata(destDir, filename, existing)
	return true
}

/**
 * Generate metadata for existing ROMs in a directory
 */
export async function generateMetadataForExisting(
	romsDir: string,
	options: {
		systems?: string[]
		withHashes?: boolean
		overwrite?: boolean
		verbose?: boolean
		quiet?: boolean
	} = {},
): Promise<{ created: number; skipped: number; failed: number }> {
	type SpinnerLike = {
		text: string
		stop: () => void
		start: () => void
		succeed: (text: string) => void
	}
	const { readdirSync, existsSync } = await import("node:fs")
	const { statSync } = await import("node:fs")
	const { join } = await import("node:path")
	const { hashFile } = await import("./hash.js")
	const { ui } = await import("./ui.js")

	const systemSourceMap: Record<
		string,
		{ source: "no-intro" | "redump"; extensions: string[] }
	> = {
		FC: { source: "no-intro", extensions: [".nes", ".fds"] },
		GB: { source: "no-intro", extensions: [".gb"] },
		GBA: { source: "no-intro", extensions: [".gba"] },
		GBC: { source: "no-intro", extensions: [".gbc"] },
		MD: { source: "no-intro", extensions: [".md", ".bin", ".gen"] },
		PCE: { source: "no-intro", extensions: [".pce"] },
		PKM: { source: "no-intro", extensions: [".min"] },
		SGB: { source: "no-intro", extensions: [".gb", ".gbc"] },
		PS: { source: "redump", extensions: [".bin", ".cue", ".chd", ".pbp"] },
	}

	let created = 0
	let skipped = 0
	let failed = 0

	const systemsToProcess = options.systems || Object.keys(systemSourceMap)

	// First pass: count total files
	let totalFiles = 0
	for (const system of systemsToProcess) {
		const systemInfo = systemSourceMap[system]
		if (!systemInfo) continue

		const systemDir = join(romsDir, system)
		if (!existsSync(systemDir)) continue

		const files = readdirSync(systemDir)
		totalFiles += files.filter(f => {
			if (f.endsWith(".json") || f.startsWith(".")) return false
			const ext = f.substring(f.lastIndexOf(".")).toLowerCase()
			return systemInfo.extensions.includes(ext)
		}).length
	}

	let processed = 0
	let spinner: SpinnerLike | null = null
	if (!options.quiet) {
		spinner = {
			text: "",
			stop: () => {},
			start: () => {},
			succeed: (text: string) => {
				ui.success(text)
			},
		}
	}

	for (const system of systemsToProcess) {
		const systemInfo = systemSourceMap[system]
		if (!systemInfo) {
			if (!options.quiet) {
				if (spinner) spinner.stop()
				ui.warn(`Unknown system: ${system}`)
				if (spinner) spinner.start()
			}
			continue
		}

		const systemDir = join(romsDir, system)
		if (!existsSync(systemDir)) {
			if (options.verbose) {
				if (spinner) spinner.stop()
				ui.debug(`System directory not found: ${system}`, true)
				if (spinner) spinner.start()
			}
			continue
		}

		const files = readdirSync(systemDir)
		const romFiles = files.filter(f => {
			if (f.endsWith(".json") || f.startsWith(".")) return false
			const ext = f.substring(f.lastIndexOf(".")).toLowerCase()
			return systemInfo.extensions.includes(ext)
		})

		for (const filename of romFiles) {
			processed++

			if (spinner) {
				const percentage = Math.round((processed / totalFiles) * 100)
				spinner.text = `[${percentage}%] Processing ${processed}/${totalFiles} ROMs (${system}/${filename.substring(0, 40)}${filename.length > 40 ? "..." : ""})${options.withHashes ? " + hashing" : ""}`
			}

			const romPath = join(systemDir, filename)
			const metadataExists = existsSync(
				join(systemDir, filename.replace(/\.[^.]+$/, "") + ".json"),
			)

			// Skip if metadata exists and not overwriting
			if (metadataExists && !options.overwrite) {
				skipped++
				continue
			}

			try {
				const stat = statSync(romPath)
				const fingerprint = { fileSize: stat.size, fileMtimeMs: stat.mtimeMs }

				// Generate hash if requested
				let hash: FileHash | undefined
				if (options.withHashes) {
					hash = await hashFile(romPath)
				}

				// Generate metadata
				const metadata = generateMetadata(
					filename,
					system,
					systemInfo.source,
					hash,
				)
				metadata.fileSize = fingerprint.fileSize
				metadata.fileMtimeMs = fingerprint.fileMtimeMs

				// Save metadata
				saveMetadata(systemDir, filename, metadata)
				created++

				if (options.verbose) {
					if (spinner) spinner.stop()
					ui.debug(
						`Created metadata for ${filename}${hash ? ` (SHA-1: ${hash.sha1})` : ""}`,
						true,
					)
					if (spinner) spinner.start()
				}
			} catch (err) {
				failed++
				if (!options.quiet) {
					if (spinner) spinner.stop()
					ui.warn(
						`Failed to generate metadata for ${filename}: ${err instanceof Error ? err.message : String(err)}`,
					)
					if (spinner) spinner.start()
				}
			}
		}
	}

	if (spinner) {
		spinner.succeed(
			`Processed ${totalFiles} ROMs: ${created} created, ${skipped} skipped, ${failed} failed`,
		)
	}

	return { created, skipped, failed }
}
