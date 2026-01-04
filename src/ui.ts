/**
 * Terminal output helpers with consistent styling
 *
 * Spinner-aware: when an ora spinner is active, all output goes through
 * spinnerSafeLog() to avoid conflicts (flickering, line overwrites).
 */

import chalk from "chalk"
import { spinnerSafeLog } from "./parallel.js"

export const ui = {
	/** Section header with decorative border */
	header(text: string): void {
		spinnerSafeLog(chalk.cyan.bold(`\n═══ ${text} ═══\n`))
	},

	/** Success message with checkmark */
	success(text: string): void {
		spinnerSafeLog(chalk.green("✓") + " " + text)
	},

	/** Error message with X mark */
	error(text: string): void {
		// Errors go to stderr, but still need spinner handling
		spinnerSafeLog(chalk.red("✗") + " " + text)
	},

	/** Warning message */
	warn(text: string): void {
		spinnerSafeLog(chalk.yellow("⚠") + " " + text)
	},

	/** Info message */
	info(text: string): void {
		spinnerSafeLog(chalk.blue("ℹ") + " " + text)
	},

	/** Debug message (only shown if verbose) */
	debug(text: string, verbose: boolean): void {
		if (verbose) {
			spinnerSafeLog(chalk.dim("  → " + text))
		}
	},

	/** Banner for startup */
	banner(
		version: string,
		target: string,
		jobs: number,
		filter?: string,
		diskProfile?: string,
	): void {
		console.log(chalk.bold("Retro SD Card Creator") + ` v${version}`)
		console.log(`Target: ${chalk.cyan(target)}`)
		console.log(`Jobs: ${chalk.cyan(String(jobs))} parallel downloads`)
		if (diskProfile) {
			const profileDesc =
				diskProfile === "fast"
					? "fast (SSD/NVMe)"
					: diskProfile === "slow"
						? "slow (SD card/NAS)"
						: "balanced (HDD/USB)"
			console.log(`Disk profile: ${chalk.cyan(profileDesc)}`)
		}
		if (filter) {
			console.log(`Filter: ${chalk.cyan(filter)}`)
		}
		console.log()
	},

	/** Dry run warning banner */
	dryRunBanner(): void {
		console.log(chalk.yellow.bold("═══ DRY RUN MODE ═══"))
		console.log("No files will be downloaded. Showing what would happen.")
		console.log()
	},

	/** Format a list of results for summary */
	summarySection(title: string, items: string[], color: "green" | "red"): void {
		if (items.length === 0) return
		const colorFn = color === "green" ? chalk.green : chalk.red
		const symbol = color === "green" ? "✓" : "✗"
		console.log(colorFn(`${title} (${items.length}):`))
		for (const item of items) {
			console.log(`  ${symbol} ${item}`)
		}
	},

	/** Final status line */
	finalStatus(allSuccess: boolean): void {
		// Use direct console.log to avoid any spinner conflicts
		// Add extra newline to ensure visibility
		console.log()
		if (allSuccess) {
			console.log(chalk.green.bold("✓ All operations completed successfully!"))
		} else {
			console.log(
				chalk.yellow.bold("⚠ Some operations failed. See above for details."),
			)
		}
		console.log() // Extra newline for visibility
	},
}
