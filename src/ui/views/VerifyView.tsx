/**
 * VerifyView - ROM integrity verification interface
 *
 * Runs hash verification against stored metadata and presents a summary
 * of valid/invalid ROMs, plus detailed issues for failures.
 *
 * @module ui/views/VerifyView
 */
import { Box, Text, useApp } from "ink"
import { useEffect, useRef, useState } from "react"
import { Header, Section } from "../components/Header.js"
import { Spinner } from "../components/Spinner.js"
import { Error as ErrorMsg, Success, Warning } from "../components/Message.js"
import { colors, symbols } from "../theme.js"
import type { AppResult } from "../App.js"

export interface VerifyOptions {
	romsDir: string
	verbose?: boolean
	quiet?: boolean
}

export interface VerifyViewProps {
	options: VerifyOptions
	onComplete?: ((result: AppResult) => void) | undefined
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)

	if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`
	return `${seconds}s`
}

export function VerifyView({ options, onComplete }: VerifyViewProps) {
	const { exit } = useApp()
	const [isRunning, setIsRunning] = useState(true)
	const [invalid, setInvalid] = useState<
		Array<{ filename: string; issues: string[] }>
	>([])
	const [validCount, setValidCount] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const startTimeRef = useRef(Date.now())

	useEffect(() => {
		const run = async () => {
			try {
				const { verifyCollection } = await import("../../collection.js")

				// Ensure verification is fully UI-driven (no console output).
				const results = await verifyCollection(options.romsDir, {
					quiet: true,
					verbose: false,
				})

				const invalidResults = results
					.filter(r => !r.valid)
					.map(r => ({ filename: r.filename, issues: r.issues }))
				const valid = results.length - invalidResults.length

				setInvalid(invalidResults)
				setValidCount(valid)
				setIsRunning(false)

				const elapsed = Date.now() - startTimeRef.current
				onComplete?.({
					success: invalidResults.length === 0,
					completed: valid,
					failed: invalidResults.length,
					durationMs: elapsed,
				})

				setTimeout(() => exit(), 1000)
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				setIsRunning(false)
			}
		}

		void run()
	}, [options.romsDir, onComplete, exit])

	const elapsed = Date.now() - startTimeRef.current
	const total = validCount + invalid.length

	return (
		<Box flexDirection="column">
			<Header subtitle={options.romsDir}>Verify Collection</Header>

			{error && <ErrorMsg>{error}</ErrorMsg>}

			{isRunning && (
				<Box marginY={1}>
					<Spinner label="Verifying ROM hashes…" />
				</Box>
			)}

			{!isRunning && !error && (
				<>
					<Box
						flexDirection="column"
						marginTop={1}
						borderStyle="round"
						borderColor={colors.muted}
						paddingX={1}
					>
						<Box gap={2}>
							<Box>
								<Text color={colors.muted}>Checked: </Text>
								<Text bold>{total}</Text>
							</Box>
							<Box>
								<Text color={colors.muted}>Valid: </Text>
								<Text bold color={colors.success}>
									{validCount}
								</Text>
							</Box>
							<Box>
								<Text color={colors.muted}>Invalid: </Text>
								<Text
									bold
									color={invalid.length > 0 ? colors.error : colors.muted}
								>
									{invalid.length}
								</Text>
							</Box>
							<Box>
								<Text color={colors.muted}>Time: </Text>
								<Text>{formatDuration(elapsed)}</Text>
							</Box>
						</Box>
					</Box>

					{invalid.length > 0 && (
						<Section title="Issues">
							{invalid.map(r => (
								<Box key={r.filename} flexDirection="column" marginBottom={1}>
									<Box gap={1}>
										<Text color={colors.error}>{symbols.error}</Text>
										<Text bold>{r.filename}</Text>
									</Box>
									{r.issues.map((issue, idx) => (
										<Text key={`${r.filename}-${idx}`} color={colors.muted}>
											{issue}
										</Text>
									))}
								</Box>
							))}
						</Section>
					)}

					<Box marginTop={1}>
						{invalid.length === 0 ? (
							<Success>All ROMs verified successfully</Success>
						) : (
							<Warning>{invalid.length} ROMs failed verification</Warning>
						)}
					</Box>
				</>
			)}
		</Box>
	)
}
