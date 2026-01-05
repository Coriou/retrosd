/**
 * Shared type definitions for RetroSD CLI
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sources & Regions
// ─────────────────────────────────────────────────────────────────────────────

export type Source = "no-intro" | "redump"

export type RegionPreset =
	| "usa"
	| "english"
	| "ntsc"
	| "pal"
	| "japanese"
	| "all"

/**
 * Disk performance profiles for backpressure tuning
 * - fast: Local NVMe/SSD - high concurrency, large buffer
 * - balanced: USB HDD - moderate settings (default)
 * - slow: SD card, NAS, slow USB - conservative to prevent memory overflow
 */
export type DiskProfile = "fast" | "balanced" | "slow"

// ─────────────────────────────────────────────────────────────────────────────
// ROM Entries
// ─────────────────────────────────────────────────────────────────────────────

export interface RomEntry {
	/** Internal key (FC_CART, GB, GBA, etc.) */
	key: string
	/** Source repository */
	source: Source
	/** URL-encoded path segment on myrient */
	remotePath: string
	/** Regex to match archive files in listing */
	archiveRegex: RegExp
	/** Glob pattern for extraction (*.nes, *.gb, etc.) */
	extractGlob: string
	/** Human-readable label for display */
	label: string
	/** Whether to extract archives or keep them */
	extract: boolean
	/** Destination directory name (FC, GB, GBA, etc.) */
	destDir: string
}

// ─────────────────────────────────────────────────────────────────────────────
// BIOS Entries
// ─────────────────────────────────────────────────────────────────────────────

export interface BiosEntry {
	/** System identifier */
	system: string
	/** Target filename */
	filename: string
	/** Primary download URL */
	url: string
	/** Optional fallback URL */
	fallbackUrl?: string
	/** Optional: rename from URL filename */
	rename?: string
}

export interface SymlinkEntry {
	system: string
	linkPath: string
	targetPath: string
	label: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Download & Results
// ─────────────────────────────────────────────────────────────────────────────

export interface DownloadOptions {
	dryRun: boolean
	resume: boolean
	verbose: boolean
	quiet: boolean
	jobs: number
	retryCount: number
	retryDelay: number
}

export interface DownloadResult {
	label: string
	success: boolean
	skipped?: boolean | undefined
	error?: string | undefined
}

export interface Summary {
	completed: DownloadResult[]
	failed: DownloadResult[]
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Options
// ─────────────────────────────────────────────────────────────────────────────

export interface CliOptions {
	target: string
	dryRun: boolean
	jobs: number
	biosOnly: boolean
	romsOnly: boolean
	preset?: RegionPreset
	filter?: string
	sources?: string
	systems?: string
	resume: boolean
	nonInteractive: boolean
	quiet: boolean
	verbose: boolean
	includePrerelease: boolean
	includeUnlicensed: boolean
	includeHacks: boolean
	includeHomebrew: boolean
	includePattern?: string
	excludePattern?: string
	includeFrom?: string
	excludeFrom?: string
	region?: string
	regionPriority?: string
	lang?: string
	langScope?: string
	langInfer?: boolean
	langPriority?: string
	update: boolean
	diskProfile?: DiskProfile
	// New options for library management
	enable1G1R?: boolean
	generateMetadata?: boolean
	verifyHashes?: boolean
	convertFormats?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Management
// ─────────────────────────────────────────────────────────────────────────────

export interface CollectionManifest {
	version: number
	generatedAt: string
	systems: SystemCollection[]
	stats: CollectionStats
}

export interface SystemCollection {
	system: string
	source: Source
	romCount: number
	totalSize: number
	roms: RomInfo[]
}

export interface RomInfo {
	filename: string
	title: string
	region: string[]
	size: number
	sha1?: string | undefined
	crc32?: string | undefined
	hasMetadata: boolean
	path: string
}

export interface CollectionStats {
	totalRoms: number
	totalSize: number
	systemCount: number
	biosCount: number
}

export interface VerifyResult {
	filename: string
	path: string
	valid: boolean
	issues: string[]
}
