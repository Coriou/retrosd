/**
 * Core types for RetroSD UI decoupling
 *
 * These types define the event-based interface between
 * pure business logic (generators) and UI components (React hooks).
 */

import type { DiskProfile, RegionPreset, RomEntry, Source } from "../types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Download Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Events emitted by the download generator
 * UI components subscribe to these to update progress displays
 */
export type DownloadEvent =
	| DownloadStartEvent
	| DownloadProgressEvent
	| DownloadCompleteEvent
	| DownloadErrorEvent
	| DownloadListingEvent
	| DownloadFilteredEvent
	| DownloadBatchStartEvent
	| DownloadBatchCompleteEvent
	| DownloadExtractEvent

/** Emitted when starting to fetch a ROM source listing */
export interface DownloadListingEvent {
	type: "listing"
	system: string
	label: string
	source: Source
}

/** Emitted after filtering determines what needs downloading */
export interface DownloadFilteredEvent {
	type: "filtered"
	system: string
	label: string
	total: number
	toDownload: number
	skipped: number
	totalBytes: number
}

/** Emitted when a batch of downloads begins */
export interface DownloadBatchStartEvent {
	type: "batch-start"
	system: string
	label: string
	count: number
	totalBytes: number
}

/** Emitted when an individual file download starts */
export interface DownloadStartEvent {
	type: "start"
	id: string
	filename: string
	system: string
	expectedSize?: number
}

/** Emitted periodically during download with progress */
export interface DownloadProgressEvent {
	type: "progress"
	id: string
	filename: string
	system: string
	current: number
	total: number
	speed: number // bytes per second
	percent: number
}

/** Emitted when a download completes successfully */
export interface DownloadCompleteEvent {
	type: "complete"
	id: string
	filename: string
	system: string
	bytesDownloaded: number
	extracted?: boolean
	/** Full path to the downloaded file */
	localPath: string
}

/** Emitted when a download fails */
export interface DownloadErrorEvent {
	type: "error"
	id: string
	filename: string
	system: string
	error: string
	retryable: boolean
}

/** Emitted during extraction phase */
export interface DownloadExtractEvent {
	type: "extract"
	id: string
	filename: string
	system: string
	status: "start" | "complete" | "error"
	error?: string
}

/** Emitted when all downloads for a system complete */
export interface DownloadBatchCompleteEvent {
	type: "batch-complete"
	system: string
	label: string
	success: number
	failed: number
	skipped: number
	bytesDownloaded: number
	durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrape Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Events emitted by the scraper generator
 */
export type ScrapeEvent =
	| ScrapeScanEvent
	| ScrapeLookupEvent
	| ScrapeDownloadEvent
	| ScrapeCompleteEvent
	| ScrapeErrorEvent
	| ScrapeBatchStartEvent
	| ScrapeBatchCompleteEvent

/** Emitted when scanning a system directory for ROMs */
export interface ScrapeScanEvent {
	type: "scan"
	system: string
	romsFound: number
}

/** Emitted when starting batch scrape for a system */
export interface ScrapeBatchStartEvent {
	type: "batch-start"
	system: string
	total: number
}

/** Emitted when looking up a ROM in ScreenScraper */
export interface ScrapeLookupEvent {
	type: "lookup"
	romFilename: string
	system: string
	gameTitle?: string
	found: boolean
}

/** Emitted when downloading media for a game */
export interface ScrapeDownloadEvent {
	type: "download"
	romFilename: string
	system: string
	gameTitle: string
	mediaType: "box" | "screenshot" | "video"
	status: "start" | "complete" | "error"
	error?: string
}

/** Emitted when a ROM scrape completes */
export interface ScrapeCompleteEvent {
	type: "complete"
	romFilename: string
	system: string
	gameTitle?: string
	mediaDownloaded: {
		boxArt?: string
		screenshot?: string
		video?: string
	}
}

/** Emitted when a ROM scrape fails */
export interface ScrapeErrorEvent {
	type: "error"
	romFilename: string
	system: string
	error: string
}

/** Emitted when all ROMs in a system are scraped */
export interface ScrapeBatchCompleteEvent {
	type: "batch-complete"
	system: string
	total: number
	success: number
	failed: number
	skipped: number
	durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Download Options (for generator input)
// ─────────────────────────────────────────────────────────────────────────────

export interface DownloaderOptions {
	/** Optional path to SQLite DB (used for tracking downloads in local_roms) */
	dbPath?: string

	/** Target directory for ROMs */
	romsDir: string

	/** ROM entries to download */
	entries: RomEntry[]

	/** Dry run mode (no actual downloads) */
	dryRun: boolean

	/** Verbose logging */
	verbose: boolean

	/** Concurrent download slots */
	jobs: number

	/** Retry count for failed downloads */
	retryCount: number

	/** Delay between retries (seconds) */
	retryDelay: number

	/** Region preset for filtering */
	preset?: RegionPreset

	/** Custom filter regex */
	filter?: string

	/** Include prerelease ROMs */
	includePrerelease?: boolean

	/** Include unlicensed ROMs */
	includeUnlicensed?: boolean

	/** Include hacks */
	includeHacks?: boolean

	/** Include homebrew */
	includeHomebrew?: boolean

	/** Include patterns (globs) */
	includePatterns?: string[]

	/** Exclude patterns (globs) */
	excludePatterns?: string[]

	/** Include list (exact filenames) */
	includeList?: Set<string>

	/** Exclude list (exact filenames) */
	excludeList?: Set<string>

	/** Only keep files matching at least one parsed region code (e.g. eu, us). */
	includeRegionCodes?: string[]

	/** Drop files matching any parsed region code. */
	excludeRegionCodes?: string[]

	/** Only keep files matching at least one parsed language code (e.g. en, fr). */
	includeLanguageCodes?: string[]

	/** Drop files matching any parsed language code. */
	excludeLanguageCodes?: string[]

	/**
	 * When language tags are missing from the filename, infer language codes from
	 * unambiguous region codes (e.g. us -> en, fr -> fr). Only applies when
	 * include/exclude language filters are provided.
	 */
	inferLanguageCodes?: boolean

	/** Preferred region */
	preferredRegion?: string

	/** Region priority order */
	regionPriority?: string[]

	/** Preferred language */
	preferredLanguage?: string

	/** Language priority order */
	languagePriority?: string[]

	/** Disk performance profile */
	diskProfile?: DiskProfile

	/** Update mode (redownload changed files) */
	update: boolean

	/** Enable 1G1R deduplication */
	enable1G1R?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrape Options (for generator input)
// ─────────────────────────────────────────────────────────────────────────────

export interface ScraperOptions {
	/** System directories to scrape */
	systemDirs: Array<{ path: string; system: string }>

	/** Optional path to SQLite DB for scraper cache (defaults to <target>/.retrosd.db) */
	dbPath?: string

	/** Download box art */
	boxArt?: boolean

	/** Download screenshots */
	screenshot?: boolean

	/** Download videos */
	video?: boolean

	/** ScreenScraper username */
	username?: string

	/** ScreenScraper password */
	password?: string

	/** Developer ID */
	devId?: string

	/** Developer password */
	devPassword?: string

	/** Verbose logging */
	verbose?: boolean

	/** Concurrent API requests */
	concurrency?: number

	/** Concurrent media downloads */
	downloadConcurrency?: number

	/** Overwrite existing media */
	overwrite?: boolean

	/** Include unknown ROM extensions */
	includeUnknown?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregated State (for UI hooks)
// ─────────────────────────────────────────────────────────────────────────────

/** State for a single download item */
export interface DownloadItemState {
	id: string
	filename: string
	system: string
	status: "pending" | "downloading" | "extracting" | "complete" | "error"
	current: number
	total: number
	speed: number
	percent: number
	error?: string
}

/** Aggregated state for the download view */
export interface DownloadViewState {
	/** Per-system status */
	systems: Map<
		string,
		{
			label: string
			status: "listing" | "downloading" | "extracting" | "complete" | "error"
			total: number
			completed: number
			failed: number
			skipped: number
			bytesDownloaded: number
			totalBytes: number
		}
	>

	/** Active downloads (keyed by ID) */
	activeDownloads: Map<string, DownloadItemState>

	/** Overall progress */
	overall: {
		totalSystems: number
		completedSystems: number
		totalFiles: number
		completedFiles: number
		failedFiles: number
		bytesDownloaded: number
		totalBytes: number
		startTime: number
	}
}

/** State for a single scrape item */
export interface ScrapeItemState {
	romFilename: string
	system: string
	status: "pending" | "lookup" | "downloading" | "complete" | "error"
	gameTitle?: string
	currentMedia?: "box" | "screenshot" | "video"
	error?: string
}

/** Aggregated state for the scrape view */
export interface ScrapeViewState {
	/** Per-system status */
	systems: Map<
		string,
		{
			status: "scanning" | "scraping" | "complete" | "error"
			total: number
			completed: number
			failed: number
			skipped: number
		}
	>

	/** Active scrapes */
	activeScrapes: Map<string, ScrapeItemState>

	/** Overall progress */
	overall: {
		totalSystems: number
		completedSystems: number
		totalRoms: number
		completedRoms: number
		failedRoms: number
		startTime: number
	}
}
