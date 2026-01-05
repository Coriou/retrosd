/**
 * ScrapeView - Artwork scraper interface with API rate awareness
 *
 * Displays scraping progress with per-ROM status, system summaries,
 * and media download tracking. Uses the useScraper hook to consume
 * events from the scraper generator.
 *
 * @module ui/views/ScrapeView
 */
import { Box, Text, useApp } from "ink"
import { useEffect, useState, useMemo } from "react"
import { useScraper } from "../hooks/useScraper.js"
import { ProgressBar } from "../components/ProgressBar.js"
import { Spinner } from "../components/Spinner.js"
import { Header, Section } from "../components/Header.js"
import { Success, Error as ErrorMsg, Warning } from "../components/Message.js"
import { colors, symbols } from "../theme.js"
import { getLogFilePath } from "../../logger.js"
import type {
	ScraperOptions,
	ScrapeViewState,
	ScrapeItemState,
} from "../../core/types.js"
import type { AppResult } from "../App.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScrapeViewProps {
	options: ScraperOptions
	onComplete?: ((result: AppResult) => void) | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function truncateFilename(name: string, maxLen: number = 35): string {
	if (name.length <= maxLen) return name
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : ""
	const base = name.slice(0, name.length - ext.length)
	const truncLen = maxLen - ext.length - 1
	return `${base.slice(0, truncLen)}…${ext}`
}

const mediaEmoji: Record<string, string> = {
	box: "📦",
	screenshot: "🖼️",
	video: "🎬",
}

function formatFailureLabel(failure: {
	system: string
	romFilename: string
	gameTitle?: string
	mediaType?: "box" | "screenshot" | "video"
	error: string
}): string {
	const title = failure.gameTitle ?? failure.romFilename
	const media = failure.mediaType ? ` (${failure.mediaType})` : ""
	return `${failure.system}: ${truncateFilename(title)}${media} — ${failure.error}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveScrapeProps {
	scrape: ScrapeItemState
}

function ActiveScrape({ scrape }: ActiveScrapeProps) {
	const icon =
		scrape.status === "lookup" ? (
			<Text color={colors.accent}>🔍</Text>
		) : scrape.status === "downloading" ? (
			<Text color={colors.info}>
				{scrape.currentMedia ? mediaEmoji[scrape.currentMedia] : "📥"}
			</Text>
		) : scrape.status === "error" ? (
			<Text color={colors.error}>{symbols.error}</Text>
		) : (
			<Text color={colors.muted}>{symbols.bullet}</Text>
		)

	const statusText =
		scrape.status === "lookup"
			? "searching…"
			: scrape.status === "downloading" && scrape.currentMedia
				? `downloading ${scrape.currentMedia}…`
				: scrape.status === "error"
					? (scrape.error?.slice(0, 30) ?? "failed")
					: ""

	return (
		<Box gap={1}>
			{icon}
			<Box width={36}>
				<Text>
					{scrape.gameTitle
						? truncateFilename(scrape.gameTitle)
						: truncateFilename(scrape.romFilename)}
				</Text>
			</Box>
			<Text color={colors.muted}>{statusText}</Text>
		</Box>
	)
}

interface SystemSummaryProps {
	system: string
	status: ScrapeViewState["systems"] extends Map<string, infer T> ? T : never
}

function SystemSummary({ system, status: sys }: SystemSummaryProps) {
	const icon =
		sys.status === "complete" ? (
			<Text color={colors.success}>{symbols.success}</Text>
		) : sys.status === "error" ? (
			<Text color={colors.error}>{symbols.error}</Text>
		) : sys.status === "scanning" ? (
			<Spinner />
		) : (
			<Text color={colors.accent}>🎮</Text>
		)

	const progress = sys.total > 0 ? sys.completed / sys.total : 0

	return (
		<Box gap={1}>
			{icon}
			<Box width={12}>
				<Text bold>{system}</Text>
			</Box>
			<Box width={12}>
				<Text color={colors.muted}>
					{sys.completed}/{sys.total}
				</Text>
			</Box>
			{sys.status === "scraping" && (
				<ProgressBar progress={progress} width={25} showPercent={true} />
			)}
			{sys.status === "complete" && sys.skipped > 0 && (
				<Text color={colors.muted}> ({sys.skipped} skipped)</Text>
			)}
			{sys.failed > 0 && (
				<Text color={colors.error}> ({sys.failed} failed)</Text>
			)}
		</Box>
	)
}

interface OverallStatsProps {
	state: ScrapeViewState
	isRunning: boolean
}

function OverallStats({ state, isRunning }: OverallStatsProps) {
	const { overall } = state
	const elapsed = Date.now() - overall.startTime
	const romsPerMin = elapsed > 0 ? (overall.completedRoms / elapsed) * 60000 : 0
	const progress =
		overall.totalRoms > 0 ? overall.completedRoms / overall.totalRoms : 0

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
					<Text bold>{overall.completedRoms}</Text>
					<Text color={colors.muted}>/{overall.totalRoms} ROMs</Text>
				</Box>
				<Box>
					<Text color={colors.muted}>Rate: </Text>
					<Text bold>{romsPerMin.toFixed(1)}</Text>
					<Text color={colors.muted}> ROMs/min</Text>
				</Box>
			</Box>
			<Box gap={2}>
				<Box>
					<Text color={colors.muted}>Elapsed: </Text>
					<Text>{formatDuration(elapsed)}</Text>
				</Box>
				{overall.failedRoms > 0 && (
					<Box>
						<Text color={colors.error}>Failed: {overall.failedRoms}</Text>
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

export function ScrapeView({ options, onComplete }: ScrapeViewProps) {
	const { exit } = useApp()
	const { state, isRunning, error, failures } = useScraper(options)
	const [hasNotified, setHasNotified] = useState(false)
	const logFilePath = getLogFilePath()

	// Get active scrapes (limited to 6 for display)
	const activeScrapes = useMemo(() => {
		return Array.from(state.activeScrapes.values())
			.filter(s => s.status !== "complete")
			.slice(0, 6)
	}, [state.activeScrapes])

	// Get system summaries
	const systems = useMemo(() => {
		return Array.from(state.systems.entries())
	}, [state.systems])

	const recentFailures = useMemo(() => {
		if (failures.length === 0) return []
		const sliceFrom = Math.max(0, failures.length - 8)
		return failures.slice(sliceFrom).reverse()
	}, [failures])

	// Notify completion
	useEffect(() => {
		if (
			!isRunning &&
			!hasNotified &&
			(state.overall.totalRoms > 0 || state.overall.totalSystems > 0)
		) {
			setHasNotified(true)
			const elapsed = Date.now() - state.overall.startTime
			onComplete?.({
				success: state.overall.failedRoms === 0,
				completed: state.overall.completedRoms,
				failed: state.overall.failedRoms,
				durationMs: elapsed,
			})
			// Auto-exit after brief delay
			setTimeout(() => exit(), 1000)
		}
	}, [isRunning, hasNotified, state, onComplete, exit])

	return (
		<Box flexDirection="column">
			<Header subtitle="Fetching artwork from ScreenScraper">
				Scraping Artwork
			</Header>

			{error && <ErrorMsg>{error}</ErrorMsg>}

			{/* System list */}
			{systems.length > 0 && (
				<Section title="Systems">
					{systems.map(([key, sys]) => (
						<SystemSummary key={key} system={key} status={sys} />
					))}
				</Section>
			)}

			{/* Active scrapes */}
			{activeScrapes.length > 0 && (
				<Section title="Active Lookups">
					{activeScrapes.map(s => (
						<ActiveScrape key={`${s.system}-${s.romFilename}`} scrape={s} />
					))}
					{state.activeScrapes.size > 6 && (
						<Text color={colors.muted}>
							…and {state.activeScrapes.size - 6} more
						</Text>
					)}
				</Section>
			)}

			{/* Persistent failures (last N) */}
			{recentFailures.length > 0 && (
				<Section title="Failures">
					<Text color={colors.muted}>
						{failures.length} total (showing last {recentFailures.length})
					</Text>
					{recentFailures.map((f, idx) => (
						<Box key={`${f.system}-${f.romFilename}-${idx}`} gap={1}>
							<Text color={colors.error}>{symbols.error}</Text>
							<Text>{formatFailureLabel(f)}</Text>
						</Box>
					))}
				</Section>
			)}

			{/* Loading state */}
			{isRunning && systems.length === 0 && (
				<Spinner label="Scanning ROM directories…" />
			)}

			{/* Overall stats */}
			{state.overall.totalRoms > 0 && (
				<OverallStats state={state} isRunning={isRunning} />
			)}

			{/* Completion message */}
			{!isRunning &&
				(state.overall.totalRoms > 0 || state.overall.totalSystems > 0) && (
					<Box marginTop={1}>
						{state.overall.failedRoms === 0 ? (
							<Success>
								Scrape complete: {state.overall.completedRoms} games processed
							</Success>
						) : (
							<Box flexDirection="column">
								<Warning>
									Scrape finished with {state.overall.failedRoms} errors
								</Warning>
								{logFilePath && (
									<Text color={colors.muted}>See logs: {logFilePath}</Text>
								)}
							</Box>
						)}
					</Box>
				)}
		</Box>
	)
}
