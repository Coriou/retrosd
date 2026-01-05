/**
 * Core module exports
 *
 * This module provides pure business logic for ROM downloading and artwork scraping
 * using async generators. The generators emit events that UI components can consume
 * via React hooks.
 */

// Download engine
export { downloadRoms } from "./downloader.js"
export type { DownloadEvent, DownloaderOptions } from "./downloader.js"

// Scraper engine
export { scrapeArtwork, validateCredentials } from "./scraper/index.js"

// Catalog sync engine
export { syncCatalog, getSyncStates, getCatalogStats } from "./catalog-sync.js"
export type { SyncOptions, CatalogSyncEvent } from "./catalog-sync.js"

// Shared types
export type {
	ScrapeEvent,
	ScraperOptions,
	DownloadViewState,
	DownloadItemState,
	ScrapeViewState,
	ScrapeItemState,
} from "./types.js"
