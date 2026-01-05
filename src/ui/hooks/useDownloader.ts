/**
 * React hook for consuming the download generator
 *
 * Bridges the async generator pattern with React state management.
 * Use this hook in Ink components to display download progress.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import type {
	DownloadEvent,
	DownloaderOptions,
	DownloadViewState,
	DownloadItemState,
} from "../../core/types.js"
import { downloadRoms } from "../../core/downloader.js"
import { log } from "../../logger.js"
import { useLocalRomsTracker } from "./useLocalRomsTracker.js"

/**
 * React hook that runs the download generator and maintains UI state.
 *
 * @param options Download configuration
 * @returns Current download state and control functions
 *
 * @example
 * ```tsx
 * function DownloadView({ options }) {
 *   const { state, isRunning, error } = useDownloader(options)
 *
 *   return (
 *     <Box flexDirection="column">
 *       {Array.from(state.activeDownloads.values()).map(d => (
 *         <ProgressBar key={d.id} label={d.filename} progress={d.percent} />
 *       ))}
 *     </Box>
 *   )
 * }
 * ```
 * @param dbPath Optional database path for tracking downloads in local_roms
 */
export function useDownloader(
	options: DownloaderOptions | null,
	dbPath?: string,
) {
	const trackDownload = useLocalRomsTracker(dbPath ?? null)

	const [state, setState] = useState<DownloadViewState>(() => ({
		systems: new Map(),
		activeDownloads: new Map(),
		overall: {
			totalSystems: 0,
			completedSystems: 0,
			totalFiles: 0,
			completedFiles: 0,
			failedFiles: 0,
			bytesDownloaded: 0,
			totalBytes: 0,
			startTime: Date.now(),
		},
	}))

	const [isRunning, setIsRunning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const abortRef = useRef(false)

	const processEvent = useCallback(
		(event: DownloadEvent) => {
			if (event.type === "error") {
				log.download.warn(
					{
						system: event.system,
						filename: event.filename,
						error: event.error,
						id: event.id,
					},
					"download failed",
				)
			}

			setState(prev => {
				const newState = { ...prev }
				const systems = new Map(prev.systems)
				const activeDownloads = new Map(prev.activeDownloads)
				const overall = { ...prev.overall }

				switch (event.type) {
					case "listing": {
						systems.set(event.system, {
							label: event.label,
							status: "listing",
							total: 0,
							completed: 0,
							failed: 0,
							skipped: 0,
							bytesDownloaded: 0,
							totalBytes: 0,
						})
						overall.totalSystems++
						break
					}

					case "filtered": {
						const sys = systems.get(event.system)
						if (sys) {
							sys.total = event.toDownload
							sys.skipped = event.skipped
							sys.totalBytes = event.totalBytes
							overall.totalFiles += event.toDownload
							overall.totalBytes += event.totalBytes
						}
						break
					}

					case "batch-start": {
						const sys = systems.get(event.system)
						if (sys) {
							sys.status = "downloading"
						}
						break
					}

					case "start": {
						const download: DownloadItemState = {
							id: event.id,
							filename: event.filename,
							system: event.system,
							status: "downloading",
							current: 0,
							total: event.expectedSize ?? 0,
							speed: 0,
							percent: 0,
						}
						activeDownloads.set(event.id, download)
						break
					}

					case "progress": {
						const download = activeDownloads.get(event.id)
						if (download) {
							download.current = event.current
							download.total = event.total
							download.speed = event.speed
							download.percent = event.percent
							activeDownloads.set(event.id, { ...download })
						}
						break
					}

					case "complete": {
						// Track in SQLite if database enabled
						if (trackDownload) trackDownload(event)

						activeDownloads.delete(event.id)
						const sys = systems.get(event.system)
						if (sys) {
							sys.completed++
							sys.bytesDownloaded += event.bytesDownloaded
						}
						overall.completedFiles++
						overall.bytesDownloaded += event.bytesDownloaded
						break
					}

					case "error": {
						const download = activeDownloads.get(event.id)
						if (download) {
							download.status = "error"
							download.error = event.error
							activeDownloads.set(event.id, { ...download })
						}
						const sys = systems.get(event.system)
						if (sys) {
							sys.failed++
						}
						overall.failedFiles++
						// Remove after a delay for visibility
						setTimeout(() => {
							setState(s => {
								const ad = new Map(s.activeDownloads)
								ad.delete(event.id)
								return { ...s, activeDownloads: ad }
							})
						}, 2000)
						break
					}

					case "extract": {
						const download = activeDownloads.get(event.id)
						if (download && event.status === "start") {
							download.status = "extracting"
							activeDownloads.set(event.id, { ...download })
						} else if (download && event.status === "complete") {
							activeDownloads.delete(event.id)
						}
						break
					}

					case "batch-complete": {
						const sys = systems.get(event.system)
						if (sys) {
							sys.status = "complete"
						}
						overall.completedSystems++
						break
					}
				}

				return { systems, activeDownloads, overall }
			})
		},
		[trackDownload],
	)

	useEffect(() => {
		if (!options) return

		log.download.info(
			{
				systems: Array.from(new Set(options.entries.map(e => e.key))),
				jobs: options.jobs,
				dryRun: options.dryRun,
				update: options.update,
				diskProfile: options.diskProfile,
			},
			"download started",
		)

		abortRef.current = false
		setIsRunning(true)
		setError(null)

		const run = async () => {
			try {
				for await (const event of downloadRoms(options)) {
					if (abortRef.current) break
					processEvent(event)
				}
			} catch (err) {
				log.download.error(
					{ error: err instanceof Error ? err.message : String(err) },
					"download crashed",
				)
				setError(err instanceof Error ? err.message : String(err))
			} finally {
				log.download.info("download finished")
				setIsRunning(false)
			}
		}

		void run()

		return () => {
			abortRef.current = true
		}
	}, [options, processEvent])

	const abort = useCallback(() => {
		abortRef.current = true
	}, [])

	return { state, isRunning, error, abort }
}
