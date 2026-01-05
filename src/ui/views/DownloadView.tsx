/**
 * DownloadView - ROM download interface with multi-file progress
 *
 * Displays concurrent download progress with per-file progress bars,
 * system-level summaries, and overall statistics. Uses the useDownloader
 * hook to consume events from the download generator.
 *
 * @module ui/views/DownloadView
 */
import { Box, Text, useApp } from "ink"
import { useEffect, useState, useMemo } from "react"
import { dirname } from "node:path"
import { useDownloader } from "../hooks/useDownloader.js"
import { ProgressBar } from "../components/ProgressBar.js"
import { Spinner } from "../components/Spinner.js"
import { Header, Section } from "../components/Header.js"
import { Success, Error as ErrorMsg, Warning } from "../components/Message.js"
import { colors, symbols } from "../theme.js"
import type {
	DownloaderOptions,
	DownloadViewState,
	DownloadItemState,
} from "../../core/types.js"
import type { AppResult } from "../App.js"
import { resolveDbPath } from "../../db/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DownloadViewProps {
	options: DownloaderOptions
	onComplete?: ((result: AppResult) => void) | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB"]
	const i = Math.min(
		Math.floor(Math.log(bytes) / Math.log(k)),
		sizes.length - 1,
	)
	return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`
}

function formatSpeed(bytesPerSec: number): string {
	return `${formatBytes(bytesPerSec)}/s`
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`
	}
	return `${seconds}s`
}

function truncateFilename(name: string, maxLen: number = 40): string {
	if (name.length <= maxLen) return name
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
	const base = name.slice(0, name.length - ext.length)
	const truncLen = maxLen - ext.length - 1
	return `${base.slice(0, truncLen)}…${ext}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveDownloadProps {
	download: DownloadItemState
}

function ActiveDownload({ download }: ActiveDownloadProps) {
	const label = truncateFilename(download.filename)
	const info =
		download.status === "extracting"
			? "extracting…"
			: download.speed > 0
				? formatSpeed(download.speed)
				: undefined

	return (
		<Box gap={1}>
			<Text color={colors.muted}>{symbols.bullet}</Text>
			<Box width={42}>
				<Text>{label}</Text>
			</Box>
			<ProgressBar
				progress={download.percent / 100}
				width={20}
				showPercent={true}
				info={info}
			/>
		</Box>
	)
}

interface SystemSummaryProps {
	system: string
	status: DownloadViewState["systems"] extends Map<string, infer T> ? T : never
}

function SystemSummary({ system: _system, status: sys }: SystemSummaryProps) {
	const icon =
		sys.status === "complete" ? (
			<Text color={colors.success}>{symbols.success}</Text>
		) : sys.status === "error" ? (
			<Text color={colors.error}>{symbols.error}</Text>
		) : (
			<Text color={colors.muted}>{symbols.bullet}</Text>
		)

	const progress = sys.total > 0 ? sys.completed / sys.total : 0

	return (
		<Box gap={1}>
			{icon}
			<Box width={20}>
				<Text bold>{sys.label}</Text>
			</Box>
			<Box width={14}>
				<Text color={colors.muted}>
					{sys.completed}/{sys.total}
				</Text>
			</Box>
			{sys.status === "downloading" && (
				<ProgressBar progress={progress} width={20} showPercent={true} />
			)}
			{sys.status === "complete" && (
				<Text color={colors.success}>{formatBytes(sys.bytesDownloaded)}</Text>
			)}
			{sys.failed > 0 && (
				<Text color={colors.error}> ({sys.failed} failed)</Text>
			)}
		</Box>
	)
}

interface OverallStatsProps {
	state: DownloadViewState
	isRunning: boolean
}

function OverallStats({ state, isRunning }: OverallStatsProps) {
	const { overall } = state
	const elapsed = Date.now() - overall.startTime
	const avgSpeed = elapsed > 0 ? (overall.bytesDownloaded / elapsed) * 1000 : 0
	const progress =
		overall.totalFiles > 0 ? overall.completedFiles / overall.totalFiles : 0
	const remainingBytes = Math.max(
		0,
		overall.totalBytes - overall.bytesDownloaded,
	)
	const etaMs =
		overall.totalBytes > 0 && avgSpeed > 0
			? Math.round((remainingBytes / avgSpeed) * 1000)
			: null

	return (
		<Box
			flexDirection="column"
			marginTop={1}
			borderStyle="round"
			borderColor={colors.muted}
			paddingX={1}
		>
			<Box gap={2}>
				<Box>
					<Text color={colors.muted}>Progress: </Text>
					<Text bold>{overall.completedFiles}</Text>
					<Text color={colors.muted}>/{overall.totalFiles} files</Text>
				</Box>
				<Box>
					<Text color={colors.muted}>Downloaded: </Text>
					<Text bold>{formatBytes(overall.bytesDownloaded)}</Text>
					{overall.totalBytes > 0 && (
						<Text color={colors.muted}>/{formatBytes(overall.totalBytes)}</Text>
					)}
				</Box>
			</Box>
			<Box gap={2}>
				<Box>
					<Text color={colors.muted}>Speed: </Text>
					<Text bold>{formatSpeed(avgSpeed)}</Text>
				</Box>
				<Box>
					<Text color={colors.muted}>Elapsed: </Text>
					<Text>{formatDuration(elapsed)}</Text>
				</Box>
				{etaMs !== null && (
					<Box>
						<Text color={colors.muted}>ETA: </Text>
						<Text>{formatDuration(etaMs)}</Text>
					</Box>
				)}
				{overall.failedFiles > 0 && (
					<Box>
						<Text color={colors.error}>Failed: {overall.failedFiles}</Text>
					</Box>
				)}
			</Box>
			{isRunning && (
				<Box marginTop={1}>
					<ProgressBar
						progress={progress}
						width={50}
						showPercent={true}
						color="primary"
					/>
				</Box>
			)}
		</Box>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function DownloadView({ options, onComplete }: DownloadViewProps) {
	const { exit } = useApp()
	const dbPath = useMemo(() => {
		if (options.dryRun) return undefined
		return options.dbPath ?? resolveDbPath(dirname(options.romsDir))
	}, [options.dryRun, options.romsDir])

	useEffect(() => {
		if (!dbPath) return
		void (async () => {
			try {
				const { initializeDb } = await import("../../db/migrate.js")
				await initializeDb(dbPath)
			} catch {
				// Best-effort; download should not fail if DB init fails
			}
		})()
	}, [dbPath])

	const { state, isRunning, error } = useDownloader(options, dbPath)
	const [hasNotified, setHasNotified] = useState(false)

	// Get active downloads sorted by start time (newest first, limited to 8)
	const activeDownloads = useMemo(() => {
		return Array.from(state.activeDownloads.values())
			.filter(d => d.status === "downloading" || d.status === "extracting")
			.slice(0, 8)
	}, [state.activeDownloads])

	// Get system summaries
	const systems = useMemo(() => {
		return Array.from(state.systems.entries())
	}, [state.systems])

	// Notify completion
	useEffect(() => {
		if (
			!isRunning &&
			!hasNotified &&
			(state.overall.totalFiles > 0 || state.overall.totalSystems > 0)
		) {
			setHasNotified(true)
			const elapsed = Date.now() - state.overall.startTime
			onComplete?.({
				success: state.overall.failedFiles === 0,
				completed: state.overall.completedFiles,
				failed: state.overall.failedFiles,
				bytesProcessed: state.overall.bytesDownloaded,
				durationMs: elapsed,
			})
			// Auto-exit after brief delay
			setTimeout(() => exit(), 1000)
		}
	}, [isRunning, hasNotified, state, onComplete, exit])

	return (
		<Box flexDirection="column">
			{options.dryRun ? (
				<Header subtitle="(Dry Run)">Downloading ROMs</Header>
			) : (
				<Header>Downloading ROMs</Header>
			)}

			{error && <ErrorMsg>{error}</ErrorMsg>}

			{/* System list */}
			{systems.length > 0 && (
				<Section title="Systems">
					{systems.map(([key, sys]) => (
						<SystemSummary key={key} system={key} status={sys} />
					))}
				</Section>
			)}

			{/* Active downloads */}
			{activeDownloads.length > 0 && (
				<Section title="Active Downloads">
					{activeDownloads.map(d => (
						<ActiveDownload key={d.id} download={d} />
					))}
					{state.activeDownloads.size > 8 && (
						<Text color={colors.muted}>
							…and {state.activeDownloads.size - 8} more
						</Text>
					)}
				</Section>
			)}

			{/* Loading state before first events */}
			{isRunning && systems.length === 0 && (
				<Spinner label="Fetching ROM listings…" />
			)}

			{/* Overall stats */}
			{state.overall.totalFiles > 0 && (
				<OverallStats state={state} isRunning={isRunning} />
			)}

			{/* Completion message */}
			{!isRunning && state.overall.totalFiles > 0 && (
				<Box marginTop={1}>
					{state.overall.failedFiles === 0 ? (
						<Success>
							Download complete: {state.overall.completedFiles} files,{" "}
							{formatBytes(state.overall.bytesDownloaded)}
						</Success>
					) : (
						<Warning>
							Download finished with {state.overall.failedFiles} errors
						</Warning>
					)}
				</Box>
			)}
		</Box>
	)
}
