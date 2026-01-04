/**
 * Parallel execution with concurrency control and progress tracking
 */

import pLimit from "p-limit"
import ora, { type Ora } from "ora"
import { log } from "./logger.js"

export interface ParallelResult<T> {
	success: T[]
	failed: { item: unknown; error: string }[]
}

export interface ParallelOptions {
	concurrency: number
	label: string
	quiet: boolean
	/** If true, don't show a spinner (use for verbose tasks that log frequently) */
	noSpinner?: boolean
}

/** Context passed to each parallel task for spinner-safe logging */
export interface ParallelContext {
	/** Log a message (will pause spinner if active) */
	log: (message: string) => void
}

// Global spinner reference for spinner-safe logging
let activeSpinner: Ora | null = null
let spinnerText = ""

// Mutex for serializing log operations to prevent race conditions
let logLock = Promise.resolve()

/**
 * Log a message while a spinner is active.
 * Stops the spinner, prints the message, then restarts it.
 * Uses a mutex to prevent concurrent log operations from interfering.
 */
export function spinnerSafeLog(message: string): void {
	// Also log to pino for structured logging
	log.parallel.debug(message)

	if (activeSpinner) {
		// Queue this log operation to prevent race conditions
		logLock = logLock.then(
			() =>
				new Promise<void>(resolve => {
					if (activeSpinner) {
						activeSpinner.stop()
						console.log(message)
						activeSpinner.start(spinnerText)
					} else {
						console.log(message)
					}
					// Small delay to let terminal render
					setImmediate(resolve)
				}),
		)
	} else {
		console.log(message)
	}
}

/**
 * Run async tasks in parallel with limited concurrency
 */
export async function runParallel<T, R>(
	items: T[],
	fn: (item: T, index: number, ctx: ParallelContext) => Promise<R>,
	options: ParallelOptions,
): Promise<ParallelResult<R>> {
	const { concurrency, label, quiet, noSpinner } = options
	const limit = pLimit(concurrency)

	const success: R[] = []
	const failed: { item: unknown; error: string }[] = []
	let completed = 0
	const total = items.length

	let spinner: Ora | null = null
	if (!quiet && !noSpinner && total > 0) {
		spinnerText = `${label}: 0/${total}`
		spinner = ora({
			text: spinnerText,
			prefixText: "",
		}).start()
		activeSpinner = spinner
	}

	const updateProgress = (): void => {
		if (spinner) {
			spinnerText = `${label}: ${completed}/${total}`
			spinner.text = spinnerText
		}
	}

	const ctx: ParallelContext = {
		log: spinnerSafeLog,
	}

	const tasks = items.map((item, index) =>
		limit(async () => {
			try {
				const result = await fn(item, index, ctx)
				success.push(result)
			} catch (err) {
				failed.push({
					item,
					error: err instanceof Error ? err.message : String(err),
				})
			} finally {
				completed++
				updateProgress()
			}
		}),
	)

	await Promise.all(tasks)

	// Wait for any pending log operations to complete
	await logLock

	activeSpinner = null

	if (spinner) {
		if (failed.length === 0) {
			spinner.succeed(`${label}: ${total} completed`)
		} else {
			spinner.warn(
				`${label}: ${success.length} completed, ${failed.length} failed`,
			)
		}
	}

	return { success, failed }
}

/**
 * Create a simple progress spinner for a single operation
 */
export function createSpinner(text: string, quiet: boolean): Ora | null {
	if (quiet) return null
	return ora(text).start()
}
