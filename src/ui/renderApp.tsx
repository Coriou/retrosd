/**
 * renderApp - CLI entry point for Ink UI
 *
 * Provides functions to render the App component from CLI commands.
 * Handles async completion handling and process exit codes.
 *
 * @module ui/renderApp
 */
import { render } from "ink"
import { App, type AppProps, type AppResult, type Command } from "./App.js"
import type { DownloaderOptions, ScraperOptions } from "../core/types.js"
import { configureLogging } from "../logger.js"
import type {
	ScanOptions,
	VerifyOptions,
	ConvertOptions,
} from "./views/index.js"

let inkLoggingConfigured = false

function ensureInkLogging() {
	if (inkLoggingConfigured) return
	configureLogging({ ink: true })
	inkLoggingConfigured = true
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderResult {
	result: AppResult | null
	waitUntilExit: () => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Render Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render the download view with Ink
 */
export function renderDownload(options: DownloaderOptions): RenderResult {
	let result: AppResult | null = null
	ensureInkLogging()

	const { waitUntilExit } = render(
		<App
			command="download"
			downloadOptions={options}
			onComplete={r => {
				result = r
			}}
		/>,
	)

	return {
		get result() {
			return result
		},
		waitUntilExit,
	}
}

/**
 * Render the scrape view with Ink
 */
export function renderScrape(options: ScraperOptions): RenderResult {
	let result: AppResult | null = null
	ensureInkLogging()

	const { waitUntilExit } = render(
		<App
			command="scrape"
			scrapeOptions={options}
			onComplete={r => {
				result = r
			}}
		/>,
	)

	return {
		get result() {
			return result
		},
		waitUntilExit,
	}
}

/**
 * Render the scan view with Ink
 */
export function renderScan(options: ScanOptions): RenderResult {
	let result: AppResult | null = null
	ensureInkLogging()

	const { waitUntilExit } = render(
		<App
			command="scan"
			scanOptions={options}
			onComplete={r => {
				result = r
			}}
		/>,
	)

	return {
		get result() {
			return result
		},
		waitUntilExit,
	}
}

/**
 * Render the verify view with Ink
 */
export function renderVerify(options: VerifyOptions): RenderResult {
	let result: AppResult | null = null
	ensureInkLogging()

	const { waitUntilExit } = render(
		<App
			command="verify"
			verifyOptions={options}
			onComplete={r => {
				result = r
			}}
		/>,
	)

	return {
		get result() {
			return result
		},
		waitUntilExit,
	}
}

/**
 * Render the convert view with Ink
 */
export function renderConvert(options: ConvertOptions): RenderResult {
	let result: AppResult | null = null
	ensureInkLogging()

	const { waitUntilExit } = render(
		<App
			command="convert"
			convertOptions={options}
			onComplete={r => {
				result = r
			}}
		/>,
	)

	return {
		get result() {
			return result
		},
		waitUntilExit,
	}
}

/**
 * Generic render function for any command
 */
export function renderApp(
	command: Command,
	options: {
		downloadOptions?: DownloaderOptions
		scrapeOptions?: ScraperOptions
		scanOptions?: ScanOptions
		verifyOptions?: VerifyOptions
		convertOptions?: ConvertOptions
	},
): RenderResult {
	let result: AppResult | null = null
	ensureInkLogging()

	const props: AppProps = {
		command,
		...options,
		onComplete: r => {
			result = r
		},
	}

	const { waitUntilExit } = render(<App {...props} />)

	return {
		get result() {
			return result
		},
		waitUntilExit,
	}
}

/**
 * Run the download view and wait for completion
 * Returns the exit code (0 for success, 1 for failures)
 */
export async function runDownloadView(
	options: DownloaderOptions,
): Promise<number> {
	const { result, waitUntilExit } = renderDownload(options)
	await waitUntilExit()
	return result?.failed ? 1 : 0
}

/**
 * Run the scrape view and wait for completion
 */
export async function runScrapeView(options: ScraperOptions): Promise<number> {
	const { result, waitUntilExit } = renderScrape(options)
	await waitUntilExit()
	return result?.failed ? 1 : 0
}

/**
 * Run the scan view and wait for completion
 */
export async function runScanView(options: ScanOptions): Promise<number> {
	const { result, waitUntilExit } = renderScan(options)
	await waitUntilExit()
	return result?.failed ? 1 : 0
}

/**
 * Run the verify view and wait for completion
 */
export async function runVerifyView(options: VerifyOptions): Promise<number> {
	const { result, waitUntilExit } = renderVerify(options)
	await waitUntilExit()
	return result?.failed ? 1 : 0
}

/**
 * Run the convert view and wait for completion
 */
export async function runConvertView(options: ConvertOptions): Promise<number> {
	const { result, waitUntilExit } = renderConvert(options)
	await waitUntilExit()
	return result?.failed ? 1 : 0
}
