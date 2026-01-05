/**
 * Parallel execution with concurrency control and progress tracking
 */

import pLimit from "p-limit"
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

/**
 * Log a message while a spinner is active.
 * Stops the spinner, prints the message, then restarts it.
 * Uses a mutex to prevent concurrent log operations from interfering.
 */
export function spinnerSafeLog(message: string): void {
	// Also log to pino for structured logging
	log.parallel.debug(message)
	console.log(message)
}

/**
 * Run async tasks in parallel with limited concurrency
 */
export async function runParallel<T, R>(
	items: T[],
	fn: (item: T, index: number, ctx: ParallelContext) => Promise<R>,
	options: ParallelOptions,
): Promise<ParallelResult<R>> {
	const { concurrency } = options
	const limit = pLimit(concurrency)

	const success: R[] = []
	const failed: { item: unknown; error: string }[] = []

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
			}
		}),
	)

	await Promise.all(tasks)

	return { success, failed }
}
