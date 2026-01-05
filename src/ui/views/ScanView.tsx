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
import { existsSync } from "node:fs"
import { Spinner } from "../components/Spinner.js"
import { Header, Section } from "../components/Header.js"
import { Success, Info } from "../components/Message.js"
import { colors, symbols } from "../theme.js"
import type { AppResult } from "../App.js"
import { computeScanStats, type ScanStats } from "../../scan/stats.js"

function inferCatalogSystemKey(
	systemDir: string,
	localFilename: string,
): string {
	if (systemDir === "FC") {
		const ext = localFilename
			.slice(localFilename.lastIndexOf("."))
			.toLowerCase()
		return ext === ".fds" ? "FC_FDS" : "FC_CART"
	}

	// These match collection.ts's SYSTEM_SOURCE_MAP keys
	const map: Record<string, string> = {
		GB: "GB",
		GBA: "GBA",
		GBC: "GBC",
		MD: "MD",
		PCE: "PCE",
		PKM: "PKM",
		SGB: "SGB",
		PS: "PS",
	}

	return map[systemDir] ?? systemDir
}

function inferCatalogFilename(localFilename: string): string {
	const dot = localFilename.lastIndexOf(".")
	const base = dot > 0 ? localFilename.slice(0, dot) : localFilename
	return `${base}.zip`
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanOptions {
	romsDir: string
	/** Optional path to SQLite DB for displaying catalog/search stats */
	dbPath?: string
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
	stats?: ScanStats
	dbStats?: {
		catalogTotalRoms: number
		catalogSystems: number
		localRoms: number
		syncLastSyncedAt: string | null
		syncStatusCounts: {
			synced: number
			stale: number
			syncing: number
			error: number
			other: number
		}
	} | null
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
	const [error, setError] = useState<string | null>(null)
	const startTimeRef = useRef(Date.now())

	useEffect(() => {
		const run = async () => {
			try {
				const { scanCollection, exportManifest } =
					await import("../../collection.js")
				const { getDb, closeDb } = await import("../../db/index.js")
				const { getDbStats } = await import("../../db/queries/stats.js")
				const { recordLocalFile } =
					await import("../../db/queries/local-roms.js")

				// We'll use the existing scanner which returns a manifest
				const manifest = await scanCollection(options.romsDir, {
					includeHashes: options.includeHashes ?? false,
					verbose: options.verbose ?? false,
					quiet: true, // Suppress console output; we render with Ink
				})

				if (options.outputFile) {
					exportManifest(manifest, options.outputFile)
				}

				// Reconcile pre-existing ROM files into local_roms so search can mark them as local
				if (options.dbPath && existsSync(options.dbPath)) {
					try {
						const db = getDb(options.dbPath)
						for (const sys of manifest.systems) {
							for (const rom of sys.roms) {
								recordLocalFile(db, {
									localPath: rom.path,
									fileSize: rom.size,
									system: inferCatalogSystemKey(sys.system, rom.filename),
									filename: inferCatalogFilename(rom.filename),
									...(rom.sha1 ? { sha1: rom.sha1 } : {}),
									...(rom.crc32 ? { crc32: rom.crc32 } : {}),
								})
							}
						}
					} finally {
						closeDb()
					}
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

				const stats = computeScanStats(manifest)

				let dbStats: ScanResult["dbStats"] = null
				if (options.dbPath && existsSync(options.dbPath)) {
					try {
						const db = getDb(options.dbPath)
						const stats = getDbStats(db)
						dbStats = {
							catalogTotalRoms: stats.catalog.totalRoms,
							catalogSystems: stats.catalog.systemCount,
							localRoms: stats.catalog.localRoms,
							syncLastSyncedAt: stats.sync.lastSyncedAt,
							syncStatusCounts: stats.sync.statusCounts,
						}
					} catch {
						dbStats = null
					} finally {
						closeDb()
					}
				}

				setResult({ systems, totalRoms, totalBytes, stats, dbStats })
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
					<Spinner label={"Scanning directories…"} />
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

					{result.stats && (
						<>
							<Section title="Coverage">
								<Box flexDirection="column">
									<Text color={colors.muted}>
										Metadata: {result.stats.coverage.withMetadata}/
										{result.stats.totals.roms} (
										{(
											(result.stats.coverage.withMetadata /
												Math.max(1, result.stats.totals.roms)) *
											100
										).toFixed(1)}
										% )
									</Text>
									<Text color={colors.muted}>
										SHA-1: {result.stats.coverage.hasSha1}/
										{result.stats.totals.roms} (
										{(
											(result.stats.coverage.hasSha1 /
												Math.max(1, result.stats.totals.roms)) *
											100
										).toFixed(1)}
										% )
									</Text>
									<Text color={colors.muted}>
										CRC32: {result.stats.coverage.hasCrc32}/
										{result.stats.totals.roms} (
										{(
											(result.stats.coverage.hasCrc32 /
												Math.max(1, result.stats.totals.roms)) *
											100
										).toFixed(1)}
										% )
									</Text>
								</Box>
							</Section>

							<Section title="Regions">
								<Box flexDirection="column">
									{result.stats.regions.overall.length === 0 && (
										<Text color={colors.muted}>No region data found</Text>
									)}
									{result.stats.regions.overall.map(r => (
										<Text key={r.region}>
											<Text bold>{r.region}</Text>
											<Text color={colors.muted}>: {r.count}</Text>
										</Text>
									))}
								</Box>
							</Section>

							<Section title="Variants">
								<Box flexDirection="column">
									<Text color={colors.muted}>
										Titles with variants:{" "}
										{result.stats.duplicates.titlesWithVariants}
									</Text>
									{result.stats.duplicates.topTitles.length > 0 && (
										<Box flexDirection="column" marginTop={1}>
											{result.stats.duplicates.topTitles.map(t => (
												<Text key={t.title}>
													<Text bold>{t.title}</Text>
													<Text color={colors.muted}>: {t.variants}</Text>
												</Text>
											))}
										</Box>
									)}
								</Box>
							</Section>

							<Section title="Tags">
								<Box flexDirection="column">
									<Text color={colors.muted}>
										Prerelease: {result.stats.tags.prerelease}
										{"  "}Unlicensed: {result.stats.tags.unlicensed}
										{"  "}Hacks: {result.stats.tags.hack}
										{"  "}Homebrew: {result.stats.tags.homebrew}
									</Text>
								</Box>
							</Section>
						</>
					)}

					{options.dbPath && (
						<Box marginTop={1}>
							<Section title="Database">
								<Box flexDirection="column" gap={0}>
									<Box>
										<Text color={colors.muted}>DB: </Text>
										<Text>{options.dbPath}</Text>
									</Box>
									{!result.dbStats && (
										<Text color={colors.muted}>
											No catalog stats available (run "retrosd sync" first)
										</Text>
									)}
									{result.dbStats && (
										<>
											<Box>
												<Text color={colors.muted}>Catalog: </Text>
												<Text>
													{result.dbStats.catalogTotalRoms.toLocaleString()}{" "}
													ROMs across {result.dbStats.catalogSystems} systems (
													{result.dbStats.localRoms.toLocaleString()} local)
												</Text>
											</Box>
											<Box>
												<Text color={colors.muted}>Sync: </Text>
												<Text>
													{result.dbStats.syncLastSyncedAt ?? "never"}
													{"  "}synced:{result.dbStats.syncStatusCounts.synced}{" "}
													stale:{result.dbStats.syncStatusCounts.stale} error:
													{result.dbStats.syncStatusCounts.error}
												</Text>
											</Box>
										</>
									)}
								</Box>
							</Section>
						</Box>
					)}

					<Box marginTop={1}>
						<Success>Scan complete</Success>
					</Box>
				</>
			)}
		</Box>
	)
}
