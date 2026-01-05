/**
 * ScanView - ROM collection scanner interface
 *
 * Displays scanning progress as ROMs are catalogued, with final
 * statistics and optional hash computation status.
 *
 * @module ui/views/ScanView
 */
import { Box, Text, useApp } from "ink"
import { useEffect, useState, useRef } from "react"
import { Spinner } from "../components/Spinner.js"
import { Header, Section } from "../components/Header.js"
import { Success, Info } from "../components/Message.js"
import { ProgressBar } from "../components/ProgressBar.js"
import { colors, symbols } from "../theme.js"
import type { AppResult } from "../App.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanOptions {
	romsDir: string
	includeHashes?: boolean
	verbose?: boolean
	quiet?: boolean
	outputFile?: string
}

export interface ScanViewProps {
	options: ScanOptions
	onComplete?: ((result: AppResult) => void) | undefined
}

interface ScanResult {
	systems: Map<string, { count: number; bytes: number }>
	totalRoms: number
	totalBytes: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.min(
		Math.floor(Math.log(bytes) / Math.log(k)),
		sizes.length - 1,
	)
	return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`
	}
	return `${seconds}s`
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scanner view - uses existing scanCollection function but displays
 * with Ink components. Since scanning happens in a single async call,
 * we show a spinner during scan and results after.
 */
export function ScanView({ options, onComplete }: ScanViewProps) {
	const { exit } = useApp()
	const [isScanning, setIsScanning] = useState(true)
	const [result, setResult] = useState<ScanResult | null>(null)
	const [currentSystem, setCurrentSystem] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const startTimeRef = useRef(Date.now())

	useEffect(() => {
		const run = async () => {
			try {
				const { scanCollection, exportManifest } =
					await import("../../collection.js")

				// We'll use the existing scanner which returns a manifest
				const manifest = await scanCollection(options.romsDir, {
					includeHashes: options.includeHashes ?? false,
					verbose: options.verbose ?? false,
					quiet: true, // Suppress console output; we render with Ink
				})

				if (options.outputFile) {
					exportManifest(manifest, options.outputFile)
				}

				// Convert manifest to our display format
				const systems = new Map<string, { count: number; bytes: number }>()
				let totalRoms = 0
				let totalBytes = 0

				// Iterate over systems, then roms within each system
				for (const sys of manifest.systems) {
					for (const rom of sys.roms) {
						const current = systems.get(sys.system) ?? { count: 0, bytes: 0 }
						current.count++
						current.bytes += rom.size
						systems.set(sys.system, current)
						totalRoms++
						totalBytes += rom.size
					}
				}

				setResult({ systems, totalRoms, totalBytes })
				setIsScanning(false)

				const elapsed = Date.now() - startTimeRef.current
				onComplete?.({
					success: true,
					completed: totalRoms,
					failed: 0,
					bytesProcessed: totalBytes,
					durationMs: elapsed,
				})

				// Auto-exit
				setTimeout(() => exit(), 1000)
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				setIsScanning(false)
			}
		}

		void run()
	}, [options, onComplete, exit])

	const elapsed = Date.now() - startTimeRef.current

	return (
		<Box flexDirection="column">
			<Header subtitle={options.romsDir}>Scanning Collection</Header>

			{isScanning && (
				<Box flexDirection="column" marginY={1}>
					<Spinner
						label={
							currentSystem
								? `Scanning ${currentSystem}…`
								: "Scanning directories…"
						}
					/>
					{options.includeHashes && (
						<Box marginTop={1}>
							<Info>Computing file hashes (this may take a while)</Info>
						</Box>
					)}
				</Box>
			)}

			{error && (
				<Box marginY={1}>
					<Text color={colors.error}>
						{symbols.error} {error}
					</Text>
				</Box>
			)}

			{result && (
				<>
					<Section title="Systems Found">
						{Array.from(result.systems.entries())
							.sort((a, b) => b[1].count - a[1].count)
							.map(([system, data]) => (
								<Box key={system} gap={1}>
									<Text color={colors.success}>{symbols.success}</Text>
									<Box width={15}>
										<Text bold>{system}</Text>
									</Box>
									<Box width={10}>
										<Text color={colors.muted}>{data.count} ROMs</Text>
									</Box>
									<Text color={colors.muted}>{formatBytes(data.bytes)}</Text>
								</Box>
							))}
					</Section>

					<Box
						flexDirection="column"
						marginTop={1}
						borderStyle="round"
						borderColor={colors.muted}
						paddingX={1}
					>
						<Box gap={2}>
							<Box>
								<Text color={colors.muted}>Total ROMs: </Text>
								<Text bold>{result.totalRoms}</Text>
							</Box>
							<Box>
								<Text color={colors.muted}>Total Size: </Text>
								<Text bold>{formatBytes(result.totalBytes)}</Text>
							</Box>
							<Box>
								<Text color={colors.muted}>Time: </Text>
								<Text>{formatDuration(elapsed)}</Text>
							</Box>
						</Box>
					</Box>

					<Box marginTop={1}>
						<Success>Scan complete</Success>
					</Box>
				</>
			)}
		</Box>
	)
}
