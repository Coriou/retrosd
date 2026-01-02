/**
 * Advanced progress UI for downloads with multi-bar display
 * Uses cli-progress for beautiful real-time progress tracking
 */

import cliProgress from "cli-progress"
import chalk from "chalk"

export interface DownloadProgress {
	filename: string
	current: number
	total: number
	speed: number // bytes/sec
}

export interface ProgressTracker {
	startDownload(id: string, filename: string, totalBytes: number): void
	updateDownload(id: string, current: number, speed: number): void
	completeDownload(id: string, success: boolean): void
	updateOverall(current: number, total: number, speed: number): void
	stop(): void
}

/**
 * Create a multi-bar progress tracker for ROM downloads
 */
export function createProgressTracker(
	label: string,
	quiet: boolean = false,
): ProgressTracker {
	if (quiet) {
		// Quiet mode - just console logs
		return {
			startDownload: () => {},
			updateDownload: () => {},
			completeDownload: () => {},
			updateOverall: (current: number, total: number, speed: number) => {
				const pct = total > 0 ? Math.round((current / total) * 100) : 0
				console.log(
					`${label}: ${pct}% (${formatBytes(current)}/${formatBytes(total)}) @ ${formatBytes(speed)}/s`,
				)
			},
			stop: () => {},
		}
	}

	const multibar = new cliProgress.MultiBar(
		{
			clearOnComplete: true,
			hideCursor: true,
			// Reduce refresh rate to 10 Hz (every 100ms) to prevent flickering
			// This matches our throttling interval
			fps: 10,
			// Only redraw when values actually change
			noTTYOutput: false,
			emptyOnZero: false,
			// Remove completed bars after 0ms (immediately)
			stopOnComplete: true,
			forceRedraw: false,
			format: (options, params, payload) => {
				const bar = options.barCompleteString
					?.substring(0, Math.round(params.progress * 40))
					.padEnd(40, options.barIncompleteString || " ")

				const percentage = Math.round(params.progress * 100)
				const speed = payload.speed || 0
				const filename = payload.filename || ""

				// Truncate filename from the END to show the most identifying part
				const maxFilenameLen = 45
				const displayFilename =
					filename.length > maxFilenameLen
						? filename.slice(0, maxFilenameLen - 3) + "..."
						: filename.padEnd(maxFilenameLen)

				const speedText =
					speed > 0 ? ` ${chalk.cyan(formatBytes(speed))}/s` : ""

				// Only show ETA if it's reasonable (< 30 min and speed > 20KB/s)
				const eta =
					params.eta > 0 && params.eta < 1800 && speed > 20000
						? ` ${chalk.gray("ETA " + formatEta(params.eta))}`
						: ""

				return `${chalk.gray(displayFilename)} ${bar} ${chalk.yellow(percentage + "%")}${speedText}${eta}`
			},
		},
		cliProgress.Presets.shades_grey,
	)

	// Overall progress bar
	const overallBar = multibar.create(100, 0, {
		filename: chalk.bold(`${label} - Overall`),
		speed: 0,
	})

	// Track individual download bars
	const downloadBars = new Map<
		string,
		{ bar: cliProgress.SingleBar; startTime: number }
	>()
	const completedDownloads = { count: 0, success: 0, failed: 0 }

	// Throttle overall progress updates to prevent flickering (100ms minimum interval)
	let lastOverallUpdate = 0
	let pendingOverallUpdate: NodeJS.Timeout | null = null

	return {
		startDownload(id: string, filename: string, totalBytes: number): void {
			// Don't create bar yet - wait for first progress update
			// This prevents showing bars at 0% that flicker immediately
			if (!downloadBars.has(id)) {
				downloadBars.set(id, {
					bar: null as any, // Will be created lazily
					startTime: Date.now(),
					filename,
					totalBytes,
				} as any)
			}
		},

		updateDownload(id: string, current: number, speed: number): void {
			const entry = downloadBars.get(id) as any
			if (!entry) return

			// Lazy bar creation: only create when we have actual progress (not 0%)
			if (!entry.bar && current > 0) {
				// Only show 1 active download at a time
				const activeBars = Array.from(downloadBars.values()).filter(
					(e: any) => e.bar !== null,
				)
				if (activeBars.length >= 1) {
					return // Don't create more bars
				}

				entry.bar = multibar.create(entry.totalBytes || 100, 0, {
					filename: entry.filename,
					speed: 0,
				})
			}

			if (entry.bar) {
				entry.bar.update(current, { speed })
			}
		},

		completeDownload(id: string, success: boolean): void {
			const entry = downloadBars.get(id) as any
			if (entry) {
				// Only remove if bar was actually created
				if (entry.bar) {
					multibar.remove(entry.bar)
				}
				downloadBars.delete(id)
			}

			completedDownloads.count++
			if (success) {
				completedDownloads.success++
			} else {
				completedDownloads.failed++
			}
		},

		updateOverall(current: number, total: number, speed: number): void {
			const now = Date.now()
			const shouldUpdate = now - lastOverallUpdate >= 100 // Min 100ms between updates

			// Debounce: if we're updating too frequently, schedule a final update
			if (!shouldUpdate) {
				if (pendingOverallUpdate) {
					clearTimeout(pendingOverallUpdate)
				}
				pendingOverallUpdate = setTimeout(() => {
					this.updateOverall(current, total, speed)
				}, 100)
				return
			}

			lastOverallUpdate = now
			if (pendingOverallUpdate) {
				clearTimeout(pendingOverallUpdate)
				pendingOverallUpdate = null
			}

			const progress = total > 0 ? (current / total) * 100 : 0
			const completed = completedDownloads.success + completedDownloads.failed

			// Show bytes and file counts for better context
			const bytesInfo = `${formatBytes(current)}/${formatBytes(total)}`
			const filesInfo = completed > 0 ? ` • ${completed} files` : ""

			overallBar.update(progress, {
				filename: chalk.bold(
					`${label} ${bytesInfo}${filesInfo}` +
						(completedDownloads.failed > 0
							? chalk.red(` (${completedDownloads.failed} failed)`)
							: ""),
				),
				speed,
			})
		},

		stop(): void {
			if (pendingOverallUpdate) {
				clearTimeout(pendingOverallUpdate)
				pendingOverallUpdate = null
			}
			overallBar.stop()
			multibar.stop()
		},
	}
}

/**
 * Simple spinner-based progress (fallback for system-level operations)
 */
export function createSimpleProgress(
	label: string,
	quiet: boolean = false,
): { update: (text: string) => void; stop: (success: boolean) => void } {
	if (quiet) {
		return {
			update: () => {},
			stop: () => {},
		}
	}

	let currentText = label
	let isActive = true

	// Simple text-based updates
	process.stdout.write(`${label}...\r`)

	return {
		update(text: string): void {
			if (!isActive) return
			currentText = text
			process.stdout.write(`${text}...\r`)
		},
		stop(success: boolean): void {
			if (!isActive) return
			isActive = false
			process.stdout.write("\r" + " ".repeat(currentText.length + 3) + "\r")
			console.log(
				success
					? chalk.green("✓") + " " + currentText
					: chalk.red("✗") + " " + currentText,
			)
		},
	}
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Format ETA in seconds to human-readable string
 */
function formatEta(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`
	const h = Math.floor(seconds / 3600)
	const m = Math.round((seconds % 3600) / 60)
	return `${h}h ${m}m`
}
