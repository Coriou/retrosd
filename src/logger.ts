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

import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import pino from "pino"

// Determine log level from environment or use sensible default
const level =
	process.env["LOG_LEVEL"] || (process.env["DEBUG"] ? "debug" : "info")

// Use pino-pretty for development, raw JSON for production/CI
const isDev = process.stdout.isTTY && !process.env["CI"]

export interface ConfigureLoggingOptions {
	/** When true, logs are redirected to a file (to avoid Ink redraw flicker). */
	ink: boolean
	/** Optional explicit log file path. If omitted, a per-run temp file is created. */
	logFilePath?: string
}

let currentMode: "console" | "file" = "console"
let currentLogFilePath: string | null = null

function ensureDirExists(path: string): void {
	const dir = dirname(path)
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
}

function defaultLogFilePath(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-")
	return join(process.cwd(), ".log", `retrosd-${stamp}-${process.pid}.log`)
}

function createConsoleLogger() {
	return isDev
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
				base: { pid: undefined, hostname: undefined },
			})
}

function createFileLogger(path: string) {
	ensureDirExists(path)
	// In Ink mode we often call process.exit() on failures; async destinations can
	// drop buffered logs. Use sync writes for reliability.
	const destination = pino.destination({ dest: path, sync: true })
	const fileLevel =
		process.env["LOG_LEVEL_FILE"] ??
		// If the user didn't explicitly set a level, make log files useful by default.
		(process.env["LOG_LEVEL"] || process.env["DEBUG"] ? level : "debug")
	return pino(
		{
			level: fileLevel,
			base: { pid: undefined, hostname: undefined },
			// Keep logs machine-readable when written to file.
		},
		destination,
	)
}

/**
 * Root logger instance
 * In most cases, use createLogger() to get a module-specific child logger
 */
export let logger = createConsoleLogger()

/** Configure logging. When Ink is active, redirect pino output to a file. */
export function configureLogging(options: ConfigureLoggingOptions): {
	logFilePath: string | null
} {
	if (options.ink) {
		const nextPath =
			options.logFilePath ?? currentLogFilePath ?? defaultLogFilePath()
		// Avoid recreating the logger repeatedly.
		if (currentMode === "file" && currentLogFilePath === nextPath) {
			return { logFilePath: currentLogFilePath }
		}
		currentMode = "file"
		currentLogFilePath = nextPath
		logger = createFileLogger(nextPath)
		return { logFilePath: currentLogFilePath }
	}

	if (currentMode !== "console") {
		currentMode = "console"
		currentLogFilePath = null
		logger = createConsoleLogger()
	}

	return { logFilePath: currentLogFilePath }
}

/** Returns the current log file path if file logging is enabled. */
export function getLogFilePath(): string | null {
	return currentLogFilePath
}

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
	return new Promise(resolve => {
		logger.flush(() => resolve())
	})
}

// Pre-created loggers for common modules (getters so they follow reconfiguration)
export const log = {
	get scrape() {
		return createLogger("scrape")
	},
	get download() {
		return createLogger("download")
	},
	get progress() {
		return createLogger("progress")
	},
	get parallel() {
		return createLogger("parallel")
	},
	get cli() {
		return createLogger("cli")
	},
	get db() {
		return createLogger("db")
	},
} as const
