/**
 * Centralized logging with pino
 *
 * Design: Dual-output architecture
 * - Pino handles structured JSON logging for debugging/files
 * - UI module (ui.ts) handles beautiful user-facing CLI output
 *
 * Log levels:
 * - fatal: System crash
 * - error: Operation failed
 * - warn: Recoverable issue
 * - info: Key milestones (default for production)
 * - debug: Detailed operation info (--verbose)
 * - trace: Very detailed debugging
 */

import pino from "pino"

// Determine log level from environment or use sensible default
const level = process.env["LOG_LEVEL"] || (process.env["DEBUG"] ? "debug" : "info")

// Use pino-pretty for development, raw JSON for production/CI
const isDev = process.stdout.isTTY && !process.env["CI"]

/**
 * Root logger instance
 * In most cases, use createLogger() to get a module-specific child logger
 */
export const logger = isDev
	? pino({
			level,
			transport: {
				target: "pino-pretty",
				options: {
					colorize: true,
					translateTime: "HH:MM:ss",
					ignore: "pid,hostname",
					messageFormat: "{module}: {msg}",
				},
			},
		})
	: pino({
			level,
			base: { pid: undefined, hostname: undefined }, // Cleaner output
		})

/**
 * Create a child logger for a specific module
 * @example
 * const log = createLogger("scrape")
 * log.debug({ romFilename }, "searching ScreenScraper")
 */
export function createLogger(module: string) {
	return logger.child({ module })
}

/**
 * Flush pending log writes (call before process exit)
 */
export function flushLogs(): Promise<void> {
	return new Promise((resolve) => {
		logger.flush(() => resolve())
	})
}

// Pre-created loggers for common modules
export const log = {
	scrape: createLogger("scrape"),
	download: createLogger("download"),
	progress: createLogger("progress"),
	parallel: createLogger("parallel"),
	cli: createLogger("cli"),
}
