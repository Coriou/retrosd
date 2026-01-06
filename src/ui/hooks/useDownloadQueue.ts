/**
 * Download Queue Hook
 *
 * Manages a queue of ROM downloads that can be processed in the background
 * while the user continues to browse and search for more ROMs.
 *
 * Features:
 * - Queue management (add, remove, clear)
 * - Background processing with status tracking
 * - Progress updates for active downloads
 * - Auto-extraction and conversion pipeline
 *
 * @module ui/hooks/useDownloadQueue
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { join } from "node:path"
import { downloadRoms } from "../../core/downloader.js"
import type { DownloaderOptions } from "../../core/types.js"
import { log } from "../../logger.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueuedDownload {
	/** Unique ID for this download */
	id: string
	/** System key */
	system: string
	/** Source (no-intro, redump) */
	source: string
	/** ROM filename to download */
	filename: string
	/** Current status */
	status:
		| "queued"
		| "downloading"
		| "extracting"
		| "converting"
		| "complete"
		| "error"
	/** Progress percentage (0-100) */
	progress: number
	/** Download speed in bytes/sec */
	speed: number
	/** Error message if failed */
	error?: string
	/** When added to queue */
	queuedAt: number
	/** When download started */
	startedAt?: number
	/** When completed */
	completedAt?: number
	/** Downloaded bytes */
	bytesDownloaded: number
	/** Total bytes */
	totalBytes: number
}

export interface UseDownloadQueueOptions {
	/** Path to SD card root */
	targetDir: string
	/** Database path */
	dbPath?: string
	/** Max concurrent downloads */
	maxConcurrent?: number
	/** Enable verbose logging */
	verbose?: boolean
	/** Auto-extract archives after download */
	autoExtract?: boolean
	/** Convert eligible disc images to CHD after download */
	convertChd?: boolean
}

export interface UseDownloadQueueResult {
	/** All queued downloads */
	queue: QueuedDownload[]
	/** Currently active (downloading/extracting) */
	active: QueuedDownload[]
	/** Completed downloads */
	completed: QueuedDownload[]
	/** Failed downloads */
	failed: QueuedDownload[]
	/** Total downloads in progress */
	activeCount: number
	/** Add a download to the queue */
	addDownload: (download: {
		system: string
		source: string
		filename: string
	}) => void
	/** Remove a download from queue */
	removeDownload: (id: string) => void
	/** Clear all completed/failed */
	clearCompleted: () => void
	/** Clear entire queue */
	clearAll: () => void
	/** Is queue processing */
	isProcessing: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useDownloadQueue(
	options: UseDownloadQueueOptions,
): UseDownloadQueueResult {
	const {
		targetDir,
		dbPath,
		maxConcurrent = 2,
		verbose = false,
		autoExtract = true,
		convertChd = false,
	} = options

	const [queue, setQueue] = useState<QueuedDownload[]>([])
	const processingRef = useRef(false)
	const abortControllerRef = useRef<AbortController | null>(null)

	// Add a download to the queue
	const addDownload = useCallback(
		(download: { system: string; source: string; filename: string }) => {
			const id = `${download.system}-${download.source}-${download.filename}-${Date.now()}`

			setQueue(prev => {
				// Check if already queued or completed
				const exists = prev.find(
					q =>
						q.system === download.system &&
						q.source === download.source &&
						q.filename === download.filename &&
						(q.status === "queued" ||
							q.status === "downloading" ||
							q.status === "extracting"),
				)

				if (exists) {
					log.download.debug(
						{ download },
						"download already queued or in progress",
					)
					return prev
				}

				return [
					...prev,
					{
						id,
						system: download.system,
						source: download.source,
						filename: download.filename,
						status: "queued" as const,
						progress: 0,
						speed: 0,
						queuedAt: Date.now(),
						bytesDownloaded: 0,
						totalBytes: 0,
					},
				]
			})
		},
		[],
	)

	// Remove a download from queue
	const removeDownload = useCallback((id: string) => {
		setQueue(prev => prev.filter(q => q.id !== id))
	}, [])

	// Clear completed/failed
	const clearCompleted = useCallback(() => {
		setQueue(prev =>
			prev.filter(q => q.status !== "complete" && q.status !== "error"),
		)
	}, [])

	// Clear all
	const clearAll = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort()
		}
		setQueue([])
		processingRef.current = false
	}, [])

	// Process queue
	useEffect(() => {
		if (processingRef.current) return

		const queued = queue.filter(q => q.status === "queued")
		const active = queue.filter(
			q => q.status === "downloading" || q.status === "extracting",
		)

		// Start processing if we have queued items and room for more active downloads
		if (queued.length === 0 || active.length >= maxConcurrent) {
			return
		}

		processingRef.current = true
		const nextDownload = queued[0]
		if (!nextDownload) {
			processingRef.current = false
			return
		}

		void (async () => {
			try {
				// Mark as downloading
				setQueue(prev =>
					prev.map(q =>
						q.id === nextDownload.id
							? { ...q, status: "downloading" as const, startedAt: Date.now() }
							: q,
					),
				)

				const romsDir = join(targetDir, "Roms")

				// Get the ROM entry for this download
				const { getEntriesByKeys } = await import("../../roms.js")
				const allEntries = getEntriesByKeys([nextDownload.system])
				const entry = allEntries.find(e => e.source === nextDownload.source)

				if (!entry) {
					throw new Error(
						`No downloader entry found for ${nextDownload.system} (${nextDownload.source})`,
					)
				}

				// Create downloader options
				const downloaderOptions: DownloaderOptions = {
					...(dbPath ? { dbPath } : {}),
					romsDir,
					entries: [entry],
					dryRun: false,
					verbose,
					jobs: 1,
					retryCount: 3,
					retryDelay: 2,
					update: false,
					includePrerelease: false,
					includeUnlicensed: false,
					includeHacks: false,
					includeHomebrew: false,
					includeList: new Set([nextDownload.filename.toLowerCase()]),
					diskProfile: "balanced" as const,
					enable1G1R: false,
				}

				// Track download progress
				let lastUpdate = Date.now()

				for await (const event of downloadRoms(downloaderOptions)) {
					const now = Date.now()

					switch (event.type) {
						case "progress": {
							// Throttle updates to avoid excessive re-renders
							if (now - lastUpdate < 200) break

							lastUpdate = now
							const percent = event.percent
							const speed = event.speed

							setQueue(prev =>
								prev.map(q =>
									q.id === nextDownload.id
										? {
												...q,
												progress: percent,
												speed,
												bytesDownloaded: event.current,
												totalBytes: event.total,
											}
										: q,
								),
							)
							break
						}

						case "extract": {
							if (event.status === "start") {
								setQueue(prev =>
									prev.map(q =>
										q.id === nextDownload.id
											? { ...q, status: "extracting" as const, progress: 95 }
											: q,
									),
								)
							}
							break
						}

						case "complete": {
							log.download.debug(
								{ filename: event.filename },
								"download completed",
							)
							break
						}

						case "error": {
							throw new Error(event.error ?? "Download failed")
						}
					}
				}

				// CHD conversion for eligible disc-based systems
				if (convertChd && shouldConvertToChd(nextDownload.system)) {
					await performChdConversion(nextDownload, romsDir, setQueue)
				}

				// Mark as complete
				setQueue(prev =>
					prev.map(q =>
						q.id === nextDownload.id
							? {
									...q,
									status: "complete" as const,
									progress: 100,
									completedAt: Date.now(),
								}
							: q,
					),
				)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				log.download.error({ error, download: nextDownload }, "download failed")

				setQueue(prev =>
					prev.map(q =>
						q.id === nextDownload.id
							? {
									...q,
									status: "error" as const,
									error: message,
									completedAt: Date.now(),
								}
							: q,
					),
				)
			} finally {
				processingRef.current = false
			}
		})()
	}, [
		queue,
		targetDir,
		dbPath,
		maxConcurrent,
		verbose,
		autoExtract,
		convertChd,
	])

	// Computed values
	const active = queue.filter(
		q =>
			q.status === "downloading" ||
			q.status === "extracting" ||
			q.status === "converting",
	)
	const completed = queue.filter(q => q.status === "complete")
	const failed = queue.filter(q => q.status === "error")
	const isProcessing = active.length > 0

	return {
		queue,
		active,
		completed,
		failed,
		activeCount: active.length,
		addDownload,
		removeDownload,
		clearCompleted,
		clearAll,
		isProcessing,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// CHD Conversion Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a system should have CHD conversion applied
 * Only disc-based systems benefit from CHD compression
 */
function shouldConvertToChd(system: string): boolean {
	const discBasedSystems = ["PS", "MD_SEGA_CD", "PCE_CD", "SATURN", "DREAMCAST"]
	return discBasedSystems.includes(system)
}

/**
 * Perform CHD conversion on extracted files
 */
async function performChdConversion(
	download: QueuedDownload,
	romsDir: string,
	setQueue: React.Dispatch<React.SetStateAction<QueuedDownload[]>>,
): Promise<void> {
	const { convertRomsInDirectory, checkChdman } =
		await import("../../convert.js")

	// Check if chdman is available
	const chdCheck = await checkChdman()
	if (!chdCheck.ok) {
		log.download.warn(
			{ system: download.system },
			"chdman not available, skipping CHD conversion",
		)
		return
	}

	// Mark as converting
	setQueue(prev =>
		prev.map(q =>
			q.id === download.id
				? { ...q, status: "converting" as const, progress: 97 }
				: q,
		),
	)

	const systemDir = join(romsDir, download.system)

	try {
		// Convert all CUE/BIN files in the system directory
		const result = await convertRomsInDirectory(systemDir, {
			deleteOriginals: true, // Delete originals after successful conversion
			quiet: true,
			verbose: false,
		})

		log.download.info(
			{
				system: download.system,
				converted: result.converted,
				failed: result.failed,
			},
			"CHD conversion complete",
		)
	} catch (error) {
		log.download.error(
			{ error, system: download.system },
			"CHD conversion failed",
		)
		// Don't fail the entire download if CHD conversion fails
	}
}
