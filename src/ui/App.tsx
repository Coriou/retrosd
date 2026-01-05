/**
 * App - Root component for RetroSD Ink UI
 *
 * Routes to the appropriate view based on the command being executed.
 * All views share consistent styling through the theme and component library.
 *
 * @module ui/App
 */
import { Box, Text, useApp, useInput } from "ink"
import type { DownloaderOptions, ScraperOptions } from "../core/types.js"
import { DownloadView } from "./views/DownloadView.js"
import { ScrapeView } from "./views/ScrapeView.js"
import { ScanView } from "./views/ScanView.js"
import { ConvertView, type ConvertOptions } from "./views/ConvertView.js"
import { VerifyView, type VerifyOptions } from "./views/VerifyView.js"
import { SyncView } from "./views/SyncView.js"
import {
	SearchView,
	type SearchOptions as SearchViewOptions,
} from "./views/SearchView.js"
import type { SyncOptions } from "../core/catalog-sync.js"
import { getLogFilePath } from "../logger.js"
import { colors, symbols } from "./theme.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Command =
	| "download"
	| "scrape"
	| "scan"
	| "verify"
	| "convert"
	| "sync"
	| "search"

export interface AppProps {
	command: Command
	downloadOptions?: DownloaderOptions
	scrapeOptions?: ScraperOptions
	scanOptions?: ScanOptions
	verifyOptions?: VerifyOptions
	convertOptions?: ConvertOptions
	syncOptions?: SyncOptions
	searchOptions?: SearchViewOptions
	/** Called when the operation completes */
	onComplete?: (result: AppResult) => void
	/** Show keybinding hints */
	showHints?: boolean
}

export interface ScanOptions {
	romsDir: string
	/** Optional path to SQLite DB for displaying catalog/search stats */
	dbPath?: string
	includeHashes?: boolean
	verbose?: boolean
	quiet?: boolean
	outputFile?: string
}

export interface AppResult {
	success: boolean
	completed: number
	failed: number
	skipped?: number
	bytesProcessed?: number
	durationMs: number
	/** Optional action requested by an interactive view (currently used by search). */
	nextAction?:
		| {
				type: "download"
				system: string
				source: string
				filename: string
		  }
		| undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Root application component that handles view routing and global keybindings.
 */
export function App({
	command,
	downloadOptions,
	scrapeOptions,
	scanOptions,
	verifyOptions,
	convertOptions,
	syncOptions,
	searchOptions,
	onComplete,
	showHints = true,
}: AppProps) {
	const { exit } = useApp()
	const logFilePath = getLogFilePath()

	// Global keybindings
	useInput((input, key) => {
		if (input === "q" || key.escape) {
			exit()
		}
	})

	const renderView = () => {
		switch (command) {
			case "download":
				if (!downloadOptions) {
					return (
						<Text color={colors.error}>
							{symbols.error} Download options required
						</Text>
					)
				}
				return (
					<DownloadView options={downloadOptions} onComplete={onComplete} />
				)

			case "scrape":
				if (!scrapeOptions) {
					return (
						<Text color={colors.error}>
							{symbols.error} Scrape options required
						</Text>
					)
				}
				return <ScrapeView options={scrapeOptions} onComplete={onComplete} />

			case "scan":
				if (!scanOptions) {
					return (
						<Text color={colors.error}>
							{symbols.error} Scan options required
						</Text>
					)
				}
				return <ScanView options={scanOptions} onComplete={onComplete} />

			case "verify":
				if (!verifyOptions) {
					return (
						<Text color={colors.error}>
							{symbols.error} Verify options required
						</Text>
					)
				}
				return <VerifyView options={verifyOptions} onComplete={onComplete} />

			case "convert":
				if (!convertOptions) {
					return (
						<Text color={colors.error}>
							{symbols.error} Convert options required
						</Text>
					)
				}
				return <ConvertView options={convertOptions} onComplete={onComplete} />

			case "sync":
				if (!syncOptions) {
					return (
						<Text color={colors.error}>
							{symbols.error} Sync options required
						</Text>
					)
				}
				return <SyncView options={syncOptions} onComplete={onComplete} />

			case "search":
				if (!searchOptions) {
					return (
						<Text color={colors.error}>
							{symbols.error} Search options required
						</Text>
					)
				}
				return <SearchView options={searchOptions} onComplete={onComplete} />

			default:
				return (
					<Text color={colors.error}>
						{symbols.error} Unknown command: {command}
					</Text>
				)
		}
	}

	return (
		<Box flexDirection="column" padding={1}>
			{renderView()}
			{showHints && (
				<Box marginTop={1} flexDirection="column">
					<Text color={colors.muted}>Press 'q' to quit</Text>
					{logFilePath && <Text color={colors.muted}>Logs: {logFilePath}</Text>}
				</Box>
			)}
		</Box>
	)
}
