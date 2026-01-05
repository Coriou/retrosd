/**
 * SyncView - Catalog synchronization interface
 *
 * Displays sync progress with per-system status and overall statistics.
 * Uses the useCatalogSync hook to consume events from the sync generator.
 *
 * @module ui/views/SyncView
 */
import { Box, Text, useApp } from "ink"
import { useEffect, useState, useMemo } from "react"
import {
	useCatalogSync,
	type SystemSyncState,
} from "../hooks/useCatalogSync.js"
import { ProgressBar } from "../components/ProgressBar.js"
import { Spinner } from "../components/Spinner.js"
import { Header, Section } from "../components/Header.js"
import { Success, Error as ErrorMsg, Warning } from "../components/Message.js"
import { colors, symbols } from "../theme.js"
import type { SyncOptions } from "../../core/catalog-sync.js"
import type { AppResult } from "../App.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncViewProps {
	options: SyncOptions
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

function formatNumber(n: number): string {
	return n.toLocaleString()
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

interface SystemRowProps {
	system: string
	state: SystemSyncState
}

function SystemRow({ system, state }: SystemRowProps) {
	const icon = (() => {
		switch (state.status) {
			case "pending":
				return <Text color={colors.muted}>{symbols.bullet}</Text>
			case "fetching":
				return <Spinner />
			case "parsing":
				return <Text color={colors.info}>📊</Text>
			case "syncing":
				return <Text color={colors.accent}>💾</Text>
			case "complete":
				return <Text color={colors.success}>{symbols.success}</Text>
			case "skipped":
				return <Text color={colors.warning}>⏭️</Text>
			case "error":
				return <Text color={colors.error}>{symbols.error}</Text>
		}
	})()

	const statusText = (() => {
		switch (state.status) {
			case "pending":
				return <Text color={colors.muted}>waiting…</Text>
			case "fetching":
				return <Text color={colors.info}>fetching catalog…</Text>
			case "parsing":
				return (
					<Text color={colors.info}>
						parsing {formatNumber(state.romCount)} ROMs…
					</Text>
				)
			case "syncing":
				return (
					<Text color={colors.accent}>
						+{state.inserted} ~{state.updated} ={state.unchanged}
					</Text>
				)
			case "complete":
				return (
					<Text>
						<Text color={colors.success}>
							{formatNumber(state.romCount)} ROMs
						</Text>
						<Text color={colors.muted}>
							{" "}
							in {formatDuration(state.durationMs)}
						</Text>
						{state.inserted > 0 && (
							<Text color={colors.info}> (+{state.inserted} new)</Text>
						)}
						{state.updated > 0 && (
							<Text color={colors.warning}> (~{state.updated} updated)</Text>
						)}
					</Text>
				)
			case "skipped":
				return <Text color={colors.muted}>{state.skipReason ?? "skipped"}</Text>
			case "error":
				return <Text color={colors.error}>{state.error ?? "failed"}</Text>
		}
	})()

	return (
		<Box gap={1}>
			{icon}
			<Box width={8}>
				<Text bold>{system}</Text>
			</Box>
			<Box>
				{state.label &&
					state.status !== "complete" &&
					state.status !== "skipped" && (
						<Text color={colors.muted}>[{state.label}] </Text>
					)}
				{statusText}
			</Box>
		</Box>
	)
}

interface OverallStatsProps {
	totalSystems: number
	completedSystems: number
	totalRoms: number
	startTime: number
	isRunning: boolean
}

function OverallStats({
	totalSystems,
	completedSystems,
	totalRoms,
	startTime,
	isRunning,
}: OverallStatsProps) {
	const elapsed = Date.now() - startTime
	const progress = totalSystems > 0 ? completedSystems / totalSystems : 0

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
					<Text color={colors.muted}>Systems: </Text>
					<Text bold>{completedSystems}</Text>
					<Text color={colors.muted}>/{totalSystems}</Text>
				</Box>
				<Box>
					<Text color={colors.muted}>ROMs indexed: </Text>
					<Text bold>{formatNumber(totalRoms)}</Text>
				</Box>
			</Box>
			<Box gap={2}>
				<Box>
					<Text color={colors.muted}>Elapsed: </Text>
					<Text>{formatDuration(elapsed)}</Text>
				</Box>
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

export function SyncView({ options, onComplete }: SyncViewProps) {
	const { exit } = useApp()
	const { state, isRunning, error } = useCatalogSync(options)
	const [hasNotified, setHasNotified] = useState(false)

	// Get system list
	const systems = useMemo(() => {
		return Array.from(state.systems.entries())
	}, [state.systems])

	// Calculate summary stats
	const summary = useMemo(() => {
		let errored = 0
		let skipped = 0
		for (const [, sys] of state.systems) {
			if (sys.status === "error") errored++
			if (sys.status === "skipped") skipped++
		}
		return { errored, skipped }
	}, [state.systems])

	// Notify completion
	useEffect(() => {
		if (!isRunning && !hasNotified && state.overall.totalSystems > 0) {
			setHasNotified(true)
			const elapsed = Date.now() - state.overall.startTime
			onComplete?.({
				success: summary.errored === 0,
				completed:
					state.overall.completedSystems - summary.errored - summary.skipped,
				failed: summary.errored,
				skipped: summary.skipped,
				durationMs: elapsed,
			})
			// Auto-exit after brief delay
			setTimeout(() => exit(), 1000)
		}
	}, [isRunning, hasNotified, state, summary, onComplete, exit])

	return (
		<Box flexDirection="column">
			<Header subtitle="Syncing remote catalogs to local database">
				Catalog Sync
			</Header>

			{error && <ErrorMsg>{error}</ErrorMsg>}

			{/* System list */}
			{systems.length > 0 && (
				<Section title="Systems">
					{systems.map(([key, sys]) => (
						<SystemRow key={key} system={key} state={sys} />
					))}
				</Section>
			)}

			{/* Loading state */}
			{isRunning && systems.length === 0 && (
				<Spinner label="Initializing sync…" />
			)}

			{/* Overall stats */}
			{state.overall.totalSystems > 0 && (
				<OverallStats
					totalSystems={state.overall.totalSystems}
					completedSystems={state.overall.completedSystems}
					totalRoms={state.overall.totalRoms}
					startTime={state.overall.startTime}
					isRunning={isRunning}
				/>
			)}

			{/* Completion message */}
			{!isRunning && state.overall.totalSystems > 0 && (
				<Box marginTop={1}>
					{summary.errored === 0 ? (
						<Success>
							Sync complete: {formatNumber(state.overall.totalRoms)} ROMs
							indexed
							{summary.skipped > 0 && ` (${summary.skipped} systems unchanged)`}
						</Success>
					) : (
						<Warning>Sync finished with {summary.errored} error(s)</Warning>
					)}
				</Box>
			)}
		</Box>
	)
}
