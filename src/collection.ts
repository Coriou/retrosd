/**
 * Collection management commands
 * Handles scan, verify, and export operations for ROM library
 */

import { readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { hashFile, verifyFile, type FileHash } from "./hash.js"
import { loadMetadata, parseRomFilename, saveMetadata } from "./metadata.js"
import type {
	CollectionManifest,
	SystemCollection,
	RomInfo,
	CollectionStats,
	VerifyResult,
	Source,
} from "./types.js"
import { ui } from "./ui.js"

/**
 * System directory to source mapping
 */
const SYSTEM_SOURCE_MAP: Record<string, { source: Source; key: string }> = {
	FC: { source: "no-intro", key: "FC_CART" },
	GB: { source: "no-intro", key: "GB" },
	GBA: { source: "no-intro", key: "GBA" },
	GBC: { source: "no-intro", key: "GBC" },
	MD: { source: "no-intro", key: "MD" },
	PCE: { source: "no-intro", key: "PCE" },
	PKM: { source: "no-intro", key: "PKM" },
	SGB: { source: "no-intro", key: "SGB" },
	PS: { source: "redump", key: "PS" },
}

/**
 * ROM file extensions by system
 */
const ROM_EXTENSIONS: Record<string, string[]> = {
	FC: [".nes", ".fds"],
	GB: [".gb"],
	GBA: [".gba"],
	GBC: [".gbc"],
	MD: [".md", ".bin", ".gen"],
	PCE: [".pce"],
	PKM: [".min"],
	SGB: [".gb", ".gbc"],
	PS: [".bin", ".cue", ".chd", ".pbp"],
}

/**
 * Check if a file is a ROM based on extension
 */
function isRomFile(filename: string, system: string): boolean {
	const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()
	const validExtensions = ROM_EXTENSIONS[system] || []
	return validExtensions.includes(ext)
}

/**
 * Scan a system directory and collect ROM information
 */
async function scanSystemDirectory(
	systemDir: string,
	systemName: string,
	options: { includeHashes: boolean; verbose: boolean },
): Promise<SystemCollection | null> {
	if (!existsSync(systemDir)) {
		return null
	}

	const systemInfo = SYSTEM_SOURCE_MAP[systemName]
	if (!systemInfo) {
		return null
	}

	const files = readdirSync(systemDir)
	const roms: RomInfo[] = []
	let totalSize = 0

	for (const filename of files) {
		// Skip metadata files and manifests
		if (filename.endsWith(".json") || filename.startsWith(".")) {
			continue
		}

		if (!isRomFile(filename, systemName)) {
			continue
		}

		const filePath = join(systemDir, filename)
		const stat = statSync(filePath)
		const size = stat.size
		totalSize += size

		// Load metadata if exists
		const metadata = loadMetadata(systemDir, filename)

		// Parse filename if no metadata
		const parsed = metadata
			? {
					title: metadata.title,
					region: metadata.region,
				}
			: parseRomFilename(filename, systemName, systemInfo.source)

		// Get hashes if requested (incremental when metadata has a matching fingerprint)
		let hash: FileHash | undefined
		if (options.includeHashes) {
			const canReuseFromMetadata = Boolean(
				metadata?.hash &&
				metadata.fileSize === size &&
				metadata.fileMtimeMs === stat.mtimeMs,
			)

			if (canReuseFromMetadata) {
				hash = metadata!.hash
				ui.debug(`Reused hashes for ${filename}`, options.verbose)
			} else {
				try {
					hash = await hashFile(filePath)
					ui.debug(`Hashed ${filename}: ${hash.sha1}`, options.verbose)

					if (metadata) {
						metadata.hash = hash
						metadata.fileSize = size
						metadata.fileMtimeMs = stat.mtimeMs
						metadata.updatedAt = new Date().toISOString()
						saveMetadata(systemDir, filename, metadata)
						ui.debug(`Updated metadata hashes for ${filename}`, options.verbose)
					}
				} catch (err) {
					ui.debug(
						`Failed to hash ${filename}: ${err instanceof Error ? err.message : String(err)}`,
						options.verbose,
					)
				}
			}
		}

		roms.push({
			filename,
			title: parsed.title,
			region: parsed.region,
			size,
			...(hash?.sha1 || metadata?.hash?.sha1
				? { sha1: hash?.sha1 || metadata?.hash?.sha1 }
				: {}),
			...(hash?.crc32 || metadata?.hash?.crc32
				? { crc32: hash?.crc32 || metadata?.hash?.crc32 }
				: {}),
			hasMetadata: !!metadata,
			path: filePath,
		})
	}

	// Sort by title
	roms.sort((a, b) => a.title.localeCompare(b.title))

	return {
		system: systemName,
		source: systemInfo.source,
		romCount: roms.length,
		totalSize,
		roms,
	}
}

/**
 * Scan entire collection and generate manifest
 */
export async function scanCollection(
	romsDir: string,
	options: {
		includeHashes?: boolean
		systems?: string[]
		verbose?: boolean
		quiet?: boolean
	} = {},
): Promise<CollectionManifest> {
	const includeHashes = options.includeHashes ?? false
	const systemsFilter =
		options.systems && options.systems.length > 0
			? new Set(options.systems)
			: null
	const verbose = options.verbose ?? false
	const quiet = options.quiet ?? false

	if (!quiet) {
		ui.header("Scanning ROM Collection")
		ui.info(
			`Scanning ${romsDir}${includeHashes ? " (computing hashes...)" : ""}`,
		)
	}

	const systems: SystemCollection[] = []
	let totalRoms = 0
	let totalSize = 0

	// Scan each system directory
	for (const [systemName] of Object.entries(SYSTEM_SOURCE_MAP)) {
		if (systemsFilter && !systemsFilter.has(systemName)) {
			continue
		}
		const systemDir = join(romsDir, systemName)
		const collection = await scanSystemDirectory(systemDir, systemName, {
			includeHashes,
			verbose,
		})

		if (collection && collection.romCount > 0) {
			systems.push(collection)
			totalRoms += collection.romCount
			totalSize += collection.totalSize

			if (!quiet) {
				ui.success(
					`${systemName}: ${collection.romCount} ROMs (${formatBytes(collection.totalSize)})`,
				)
			}
		}
	}

	const stats: CollectionStats = {
		totalRoms,
		totalSize,
		systemCount: systems.length,
		biosCount: 0, // TODO: scan BIOS directory
	}

	if (!quiet) {
		ui.info(
			`\nTotal: ${totalRoms} ROMs across ${systems.length} systems (${formatBytes(totalSize)})`,
		)
	}

	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		systems,
		stats,
	}
}

/**
 * Verify ROM files against their stored hashes
 */
export async function verifyCollection(
	romsDir: string,
	options: {
		verbose?: boolean
		quiet?: boolean
	} = {},
): Promise<VerifyResult[]> {
	const verbose = options.verbose ?? false
	const quiet = options.quiet ?? false

	if (!quiet) {
		ui.header("Verifying ROM Collection")
	}

	const results: VerifyResult[] = []

	// Scan each system directory
	for (const [systemName] of Object.entries(SYSTEM_SOURCE_MAP)) {
		const systemDir = join(romsDir, systemName)
		if (!existsSync(systemDir)) {
			continue
		}

		const files = readdirSync(systemDir)

		for (const filename of files) {
			// Skip metadata files and manifests
			if (filename.endsWith(".json") || filename.startsWith(".")) {
				continue
			}

			if (!isRomFile(filename, systemName)) {
				continue
			}

			const filePath = join(systemDir, filename)
			const metadata = loadMetadata(systemDir, filename)

			// Skip if no metadata with hashes
			if (!metadata || !metadata.hash) {
				continue
			}

			ui.debug(`Verifying ${filename}...`, verbose)

			try {
				const verification = await verifyFile(filePath, metadata.hash)
				const issues: string[] = []

				if (!verification.valid) {
					for (const mismatch of verification.mismatches) {
						if (mismatch === "sha1") {
							issues.push(
								`SHA-1 mismatch (expected: ${metadata.hash.sha1}, got: ${verification.actual.sha1})`,
							)
						} else if (mismatch === "crc32") {
							issues.push(
								`CRC32 mismatch (expected: ${metadata.hash.crc32}, got: ${verification.actual.crc32})`,
							)
						} else if (mismatch === "size") {
							issues.push(
								`Size mismatch (expected: ${metadata.hash.size}, got: ${verification.actual.size})`,
							)
						}
					}
				}

				results.push({
					filename,
					path: filePath,
					valid: verification.valid,
					issues,
				})

				if (!verification.valid && !quiet) {
					ui.warn(`${filename}: ${issues.join(", ")}`)
				}
			} catch (err) {
				results.push({
					filename,
					path: filePath,
					valid: false,
					issues: [
						`Failed to verify: ${err instanceof Error ? err.message : String(err)}`,
					],
				})
			}
		}
	}

	const validCount = results.filter(r => r.valid).length
	const invalidCount = results.filter(r => !r.valid).length

	if (!quiet) {
		if (invalidCount === 0) {
			ui.success(`All ${validCount} ROMs verified successfully`)
		} else {
			ui.warn(
				`Verification complete: ${validCount} valid, ${invalidCount} invalid`,
			)
		}
	}

	return results
}

/**
 * Export collection manifest to JSON file
 */
export function exportManifest(
	manifest: CollectionManifest,
	outputPath: string,
): void {
	writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf8")
}

/**
 * Generate EmulationStation gamelist.xml for a system
 */
export function generateGamelistXml(
	collection: SystemCollection,
	romsPath: string,
): string {
	const lines: string[] = []
	lines.push('<?xml version="1.0"?>')
	lines.push("<gameList>")

	for (const rom of collection.roms) {
		lines.push("\t<game>")
		lines.push(`\t\t<path>${romsPath}/${rom.filename}</path>`)
		lines.push(`\t\t<name>${escapeXml(rom.title)}</name>`)
		if (rom.region.length > 0) {
			lines.push(`\t\t<region>${escapeXml(rom.region.join(", "))}</region>`)
		}
		lines.push("\t</game>")
	}

	lines.push("</gameList>")
	return lines.join("\n")
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
