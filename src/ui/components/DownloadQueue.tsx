/**
 * DownloadQueue - Compact download status display
 *
 * Shows active downloads in a minimal, non-intrusive way at the bottom of the view.
 * Similar to VS Code's background tasks panel.
 *
 * @module ui/components/DownloadQueue
 */

import { Box, Text } from "ink"
import { colors, symbols } from "../theme.js"
import { ProgressBar } from "./ProgressBar.js"
import type { QueuedDownload } from "../hooks/useDownloadQueue.js"

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

function truncateFilename(name: string, maxLen: number = 30): string {
	if (name.length <= maxLen) return name
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
	const base = name.slice(0, name.length - ext.length)
	const truncLen = maxLen - ext.length - 1
	return `${base.slice(0, truncLen)}…${ext}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface DownloadQueuePanelProps {
	/** Active downloads */
	active: QueuedDownload[]
	/** Queued downloads */
	queued: QueuedDownload[]
	/** Completed downloads (for notification) */
	completed: QueuedDownload[]
	/** Failed downloads */
	failed: QueuedDownload[]
	/** Show detailed view */
	detailed?: boolean
}

/**
 * Compact download queue panel
 * Shows at bottom of screen with minimal footprint
 */
export function DownloadQueuePanel({
	active,
	queued,
	completed,
	failed,
	detailed = false,
}: DownloadQueuePanelProps) {
	// Don't show if nothing is happening
	if (
		active.length === 0 &&
		queued.length === 0 &&
		completed.length === 0 &&
		failed.length === 0
	) {
		return null
	}

	// Get the primary active download
	const primary = active[0]

	return (
		<Box
			flexDirection="column"
			marginTop={1}
			borderStyle="round"
			borderColor={colors.muted}
			paddingX={1}
		>
			{/* Header */}
			<Box gap={2}>
				<Text bold color={colors.info}>
					{symbols.download} Downloads
				</Text>
				{active.length > 0 && (
					<Text color={colors.muted}>
						{active.length} active
						{queued.length > 0 && ` · ${queued.length} queued`}
					</Text>
				)}
				{active.length === 0 && completed.length > 0 && (
					<Text color={colors.success}>{completed.length} completed</Text>
				)}
				{failed.length > 0 && (
					<Text color={colors.error}>{failed.length} failed</Text>
				)}
			</Box>

			{/* Primary download */}
			{primary && (
				<Box gap={1} marginTop={1}>
					{primary.status === "extracting" ||
					primary.status === "converting" ? (
						<Text color={colors.warning}>{symbols.hourglass}</Text>
					) : (
						<Text color={colors.info}>{symbols.arrow}</Text>
					)}
					<Box width={32}>
						<Text>{truncateFilename(primary.filename, 30)}</Text>
					</Box>
					<Box width={28}>
						<ProgressBar
							progress={primary.progress / 100}
							width={20}
							showPercent={true}
							color="info"
						/>
					</Box>
					{primary.status === "downloading" && primary.speed > 0 && (
						<Text color={colors.muted}>{formatSpeed(primary.speed)}</Text>
					)}
					{primary.status === "extracting" && (
						<Text color={colors.warning}>extracting…</Text>
					)}
					{primary.status === "converting" && (
						<Text color={colors.warning}>converting to CHD…</Text>
					)}
				</Box>
			)}

			{/* Additional active downloads (compact) */}
			{detailed && active.length > 1 && (
				<Box flexDirection="column" marginTop={1}>
					{active.slice(1, 3).map(download => (
						<Box key={download.id} gap={1}>
							<Text color={colors.muted}>{symbols.bullet}</Text>
							<Box width={32}>
								<Text color={colors.muted}>
									{truncateFilename(download.filename, 30)}
								</Text>
							</Box>
							<Text color={colors.muted}>{download.progress.toFixed(0)}%</Text>
						</Box>
					))}
					{active.length > 3 && (
						<Text color={colors.muted}>
							+{active.length - 3} more downloading…
						</Text>
					)}
				</Box>
			)}

			{/* Recent completions */}
			{!detailed &&
				completed.length > 0 &&
				active.length === 0 &&
				completed[0] && (
					<Box marginTop={1}>
						<Text color={colors.success}>{symbols.success}</Text>
						<Text color={colors.muted}> </Text>
						<Text>
							{completed.length === 1
								? truncateFilename(completed[0].filename, 40)
								: `${completed.length} downloads complete`}
						</Text>
					</Box>
				)}

			{/* Recent failures */}
			{!detailed && failed.length > 0 && active.length === 0 && failed[0] && (
				<Box marginTop={1}>
					<Text color={colors.error}>{symbols.error}</Text>
					<Text color={colors.muted}> </Text>
					<Text>
						{failed.length === 1
							? `Failed: ${truncateFilename(failed[0].filename, 35)}`
							: `${failed.length} downloads failed`}
					</Text>
				</Box>
			)}
		</Box>
	)
}

/**
 * Minimal one-line download status (for very limited space)
 */
export function DownloadStatusLine({
	active,
	queued,
}: DownloadQueuePanelProps) {
	if (active.length === 0 && queued.length === 0) return null

	const primary = active[0]
	if (!primary) {
		return (
			<Box>
				<Text color={colors.muted}>
					{symbols.hourglass} {queued.length} download
					{queued.length !== 1 ? "s" : ""} queued
				</Text>
			</Box>
		)
	}

	return (
		<Box gap={1}>
			<Text color={colors.info}>{symbols.download}</Text>
			<Text>{truncateFilename(primary.filename, 25)}</Text>
			<Text color={colors.muted}>{primary.progress.toFixed(0)}%</Text>
			{primary.speed > 0 && (
				<Text color={colors.muted}>· {formatSpeed(primary.speed)}</Text>
			)}
			{queued.length > 0 && (
				<Text color={colors.muted}>· +{queued.length} queued</Text>
			)}
		</Box>
	)
}
