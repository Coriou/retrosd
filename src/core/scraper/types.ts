/**
 * Scraper-specific types and constants
 *
 * Internal types used by the scraper module. Public types (events, options)
 * are defined in src/core/types.ts for consistency with the downloader.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ScreenScraper API Types
// ─────────────────────────────────────────────────────────────────────────────

/** Game data returned by ScreenScraper API */
export interface ScreenScraperGame {
	id: string
	name: string
	region: string
	media: {
		boxFront?: { url: string; format: string }
		boxBack?: { url: string; format: string }
		screenshot?: { url: string; format: string }
		video?: { url: string; format: string }
	}
}

/** Cache entry with timestamp for staleness checking */
export interface GameCacheEntry extends ScreenScraperGame {
	timestamp: number
}

/** Search options for ScreenScraper API */
export interface SearchOptions {
	username?: string | undefined
	password?: string | undefined
	devId?: string | undefined
	devPassword?: string | undefined
	crc32?: string | undefined
	sha1?: string | undefined
	verbose?: boolean | undefined
}

/** Result from media download operations */
export interface MediaDownloadResult {
	media: {
		boxArt?: string
		screenshot?: string
		video?: string
	}
	hadAny: boolean
	downloadedAny: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// System Mappings
// ─────────────────────────────────────────────────────────────────────────────

/** ScreenScraper system IDs */
export const SCREENSCRAPER_SYSTEMS: Record<string, number> = {
	FC: 3, // NES
	GB: 9, // Game Boy
	GBA: 12, // Game Boy Advance
	GBC: 10, // Game Boy Color
	MD: 1, // Genesis/Mega Drive
	PCE: 31, // PC Engine
	PS: 57, // PlayStation
	SGB: 127, // Super Game Boy
}

/** ROM file extensions by system */
export const ROM_EXTENSIONS_BY_SYSTEM: Record<string, string[]> = {
	FC: [".nes", ".fds"],
	GB: [".gb"],
	GBA: [".gba"],
	GBC: [".gbc"],
	MD: [".md", ".bin", ".gen", ".smd"],
	PCE: [".pce"],
	PS: [".bin", ".cue", ".chd", ".pbp", ".iso", ".img", ".ccd", ".mdf", ".mds"],
	SGB: [".gb", ".gbc"],
}

export const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar"])
export const EXTRA_ROM_EXTENSIONS = new Set([".m3u"])
export const NON_ROM_EXTENSIONS = new Set([
	".json",
	".xml",
	".txt",
	".nfo",
	".dat",
])

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a filename is a valid ROM for the given system
 */
export function isRomFilename(
	filename: string,
	system: string,
	includeUnknown: boolean,
): boolean {
	if (filename.startsWith(".") || filename === "media") {
		return false
	}

	const lastDot = filename.lastIndexOf(".")
	if (lastDot === -1) return false
	const ext = filename.substring(lastDot).toLowerCase()

	if (NON_ROM_EXTENSIONS.has(ext)) return false

	const allowed = ROM_EXTENSIONS_BY_SYSTEM[system]
	if (!allowed) return true

	if (
		allowed.includes(ext) ||
		ARCHIVE_EXTENSIONS.has(ext) ||
		EXTRA_ROM_EXTENSIONS.has(ext)
	) {
		return true
	}

	return includeUnknown
}

/**
 * Determine ROM type for ScreenScraper API (rom vs iso)
 */
export function guessRomType(system: string, filename: string): "rom" | "iso" {
	const lastDot = filename.lastIndexOf(".")
	const ext = lastDot === -1 ? "" : filename.substring(lastDot).toLowerCase()

	// Disc-based systems or disc formats
	if (system === "PS") return "iso"
	if (
		[
			".iso",
			".cue",
			".chd",
			".pbp",
			".ccd",
			".mdf",
			".mds",
			".img",
			".bin",
		].includes(ext)
	) {
		return "iso"
	}
	return "rom"
}
