/**
 * ProgressBar - Smooth, flicker-free progress indicator
 * @module ui/components/ProgressBar
 */
import { Box, Text } from "ink"
import { colors, progressChars, symbols } from "../theme.js"

export interface ProgressBarProps {
	/** Label to display before the progress bar */
	label?: string
	/** Progress value between 0 and 1 */
	progress: number
	/** Total width of the progress bar in characters (default: 30) */
	width?: number
	/** Show percentage text */
	showPercent?: boolean
	/** Color of the filled portion */
	color?: keyof typeof colors
	/** Additional info to show after the bar (e.g., "45.2 MB/s") */
	info?: string | undefined
}

export function ProgressBar({
	label,
	progress,
	width = 30,
	showPercent = true,
	color = "accent",
	info,
}: ProgressBarProps) {
	const clampedProgress = Math.min(1, Math.max(0, progress))
	const filledWidth = clampedProgress * width
	const fullBlocks = Math.floor(filledWidth)
	const partialIndex = Math.floor(
		(filledWidth - fullBlocks) * progressChars.partial.length,
	)
	const emptyBlocks = width - fullBlocks - (partialIndex > 0 ? 1 : 0)

	const filled = progressChars.filled.repeat(fullBlocks)
	const partial =
		partialIndex > 0 ? progressChars.partial[partialIndex - 1] : ""
	const empty = progressChars.empty.repeat(Math.max(0, emptyBlocks))

	const percent = Math.round(clampedProgress * 100)

	return (
		<Box gap={1}>
			{label && (
				<Text>
					{clampedProgress === 1 ? (
						<Text color={colors.success}>{symbols.success}</Text>
					) : (
						<Text color={colors.muted}>{symbols.bullet}</Text>
					)}{" "}
					<Text>{label}</Text>
				</Text>
			)}
			<Text color={colors[color]}>
				{filled}
				{partial}
			</Text>
			<Text color={colors.muted}>{empty}</Text>
			{showPercent && (
				<Text color={clampedProgress === 1 ? colors.success : colors.muted}>
					{percent.toString().padStart(3)}%
				</Text>
			)}
			{info && <Text color={colors.muted}>{info}</Text>}
		</Box>
	)
}
