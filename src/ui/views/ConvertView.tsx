/**
 * ConvertView - Disc image conversion interface
 *
 * Displays progress of converting disc images (ISO/BIN+CUE) to
 * compressed CHD format with per-system and overall progress.
 *
 * @module ui/views/ConvertView
 */
import { Box, Text, useApp } from "ink"
import { useEffect, useState, useRef } from "react"
import { Spinner } from "../components/Spinner.js"
import { Header, Section } from "../components/Header.js"
import { Success, Warning, Error as ErrorMsg } from "../components/Message.js"
import { ProgressBar } from "../components/ProgressBar.js"
import { colors, symbols } from "../theme.js"
import type { AppResult } from "../App.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConvertOptions {
	romsDir: string
	systems: string[]
	deleteOriginals?: boolean
	verbose?: boolean
	quiet?: boolean
}

export interface ConvertViewProps {
	options: ConvertOptions
	onComplete?: ((result: AppResult) => void) | undefined
}

interface SystemResult {
	system: string
	converted: number
	skipped: number
	failed: number
	status: "pending" | "converting" | "complete" | "error"
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ConvertView({ options, onComplete }: ConvertViewProps) {
	const { exit } = useApp()
	const [isRunning, setIsRunning] = useState(true)
	const [currentSystem, setCurrentSystem] = useState<string | null>(null)
	const [results, setResults] = useState<SystemResult[]>([])
	const [error, setError] = useState<string | null>(null)
	const startTimeRef = useRef(Date.now())

	useEffect(() => {
		const run = async () => {
			try {
				const { existsSync } = await import("node:fs")
				const { join } = await import("node:path")
				const { convertRomsInDirectory } = await import("../../convert.js")

				const systemResults: SystemResult[] = []

				for (const system of options.systems) {
					const systemDir = join(options.romsDir, system.trim())

					if (!existsSync(systemDir)) {
						systemResults.push({
							system,
							converted: 0,
							skipped: 0,
							failed: 0,
							status: "error",
						})
						setResults([...systemResults])
						continue
					}

					setCurrentSystem(system)

					const result = await convertRomsInDirectory(systemDir, {
						deleteOriginals: options.deleteOriginals ?? false,
						verbose: options.verbose ?? false,
						quiet: true, // We render with Ink
					})

					systemResults.push({
						system,
						converted: result.converted,
						skipped: result.skipped,
						failed: result.failed,
						status: result.failed > 0 ? "error" : "complete",
					})
					setResults([...systemResults])
				}

				setIsRunning(false)
				setCurrentSystem(null)

				const totals = systemResults.reduce(
					(acc, r) => ({
						converted: acc.converted + r.converted,
						skipped: acc.skipped + r.skipped,
						failed: acc.failed + r.failed,
					}),
					{ converted: 0, skipped: 0, failed: 0 },
				)

				const elapsed = Date.now() - startTimeRef.current
				onComplete?.({
					success: totals.failed === 0,
					completed: totals.converted,
					failed: totals.failed,
					skipped: totals.skipped,
					durationMs: elapsed,
				})

				setTimeout(() => exit(), 1000)
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				setIsRunning(false)
			}
		}

		void run()
	}, [options, onComplete, exit])

	const elapsed = Date.now() - startTimeRef.current
	const completedSystems = results.filter(
		r => r.status === "complete" || r.status === "error",
	).length
	const progress =
		options.systems.length > 0 ? completedSystems / options.systems.length : 0

	const totals = results.reduce(
		(acc, r) => ({
			converted: acc.converted + r.converted,
			skipped: acc.skipped + r.skipped,
			failed: acc.failed + r.failed,
		}),
		{ converted: 0, skipped: 0, failed: 0 },
	)

	return (
		<Box flexDirection="column">
			<Header subtitle="Converting disc images to CHD format">
				Convert Images
			</Header>

			{error && <ErrorMsg>{error}</ErrorMsg>}

			{/* System progress */}
			{(results.length > 0 || isRunning) && (
				<Section title="Systems">
					{results.map(r => (
						<Box key={r.system} gap={1}>
							{r.status === "complete" ? (
								<Text color={colors.success}>{symbols.success}</Text>
							) : r.status === "error" ? (
								<Text color={colors.error}>{symbols.error}</Text>
							) : (
								<Spinner />
							)}
							<Box width={12}>
								<Text bold>{r.system}</Text>
							</Box>
							<Text color={colors.muted}>
								{r.converted} converted, {r.skipped} skipped
								{r.failed > 0 && (
									<Text color={colors.error}>, {r.failed} failed</Text>
								)}
							</Text>
						</Box>
					))}
					{isRunning &&
						currentSystem &&
						!results.find(r => r.system === currentSystem) && (
							<Box gap={1}>
								<Spinner />
								<Box width={12}>
									<Text bold>{currentSystem}</Text>
								</Box>
								<Text color={colors.muted}>converting…</Text>
							</Box>
						)}
				</Section>
			)}

			{/* Overall progress */}
			{isRunning && (
				<Box marginTop={1}>
					<ProgressBar
						label={`Systems: ${completedSystems}/${options.systems.length}`}
						progress={progress}
						width={40}
						showPercent={true}
					/>
				</Box>
			)}

			{/* Summary stats */}
			{!isRunning && results.length > 0 && (
				<Box
					flexDirection="column"
					marginTop={1}
					borderStyle="round"
					borderColor={colors.muted}
					paddingX={1}
				>
					<Box gap={2}>
						<Box>
							<Text color={colors.muted}>Converted: </Text>
							<Text bold color={colors.success}>
								{totals.converted}
							</Text>
						</Box>
						<Box>
							<Text color={colors.muted}>Skipped: </Text>
							<Text>{totals.skipped}</Text>
						</Box>
						{totals.failed > 0 && (
							<Box>
								<Text color={colors.error}>Failed: {totals.failed}</Text>
							</Box>
						)}
						<Box>
							<Text color={colors.muted}>Time: </Text>
							<Text>{formatDuration(elapsed)}</Text>
						</Box>
					</Box>
				</Box>
			)}

			{/* Completion message */}
			{!isRunning && (
				<Box marginTop={1}>
					{totals.failed === 0 ? (
						<Success>Conversion complete</Success>
					) : (
						<Warning>Conversion finished with {totals.failed} errors</Warning>
					)}
				</Box>
			)}
		</Box>
	)
}
