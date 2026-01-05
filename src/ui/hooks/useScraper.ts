/**
 * React hook for consuming the scraper generator
 *
 * Bridges the async generator pattern with React state management.
 * Use this hook in Ink components to display scrape progress.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import type {
	ScrapeEvent,
	ScraperOptions,
	ScrapeViewState,
	ScrapeItemState,
} from "../../core/types.js"
import { scrapeArtwork } from "../../core/scraper/index.js"
import { log } from "../../logger.js"

export interface ScrapeFailure {
	system: string
	romFilename: string
	gameTitle?: string
	mediaType?: "box" | "screenshot" | "video"
	error: string
}

/**
 * React hook that runs the scraper generator and maintains UI state.
 *
 * @param options Scraper configuration
 * @returns Current scrape state and control functions
 */
export function useScraper(options: ScraperOptions | null) {
	const [state, setState] = useState<ScrapeViewState>(() => ({
		systems: new Map(),
		activeScrapes: new Map(),
		overall: {
			totalSystems: 0,
			completedSystems: 0,
			totalRoms: 0,
			completedRoms: 0,
			failedRoms: 0,
			startTime: Date.now(),
		},
	}))

	const [failures, setFailures] = useState<ScrapeFailure[]>([])

	const [isRunning, setIsRunning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const abortRef = useRef(false)

	const processEvent = useCallback((event: ScrapeEvent) => {
		const failure: ScrapeFailure | null = (() => {
			switch (event.type) {
				case "download": {
					if (event.status !== "error") return null
					return {
						system: event.system,
						romFilename: event.romFilename,
						gameTitle: event.gameTitle,
						mediaType: event.mediaType,
						error: event.error ?? "Download failed",
					}
				}
				case "error": {
					return {
						system: event.system,
						romFilename: event.romFilename,
						error: event.error,
					}
				}
				default:
					return null
			}
		})()

		if (failure) {
			log.scrape.warn(
				{
					system: failure.system,
					romFilename: failure.romFilename,
					gameTitle: failure.gameTitle,
					mediaType: failure.mediaType,
					error: failure.error,
				},
				"scrape failure",
			)
			setFailures(prev => {
				const next = [...prev, failure]
				return next.length > 50 ? next.slice(next.length - 50) : next
			})
		}

		setState(prev => {
			const systems = new Map(prev.systems)
			const activeScrapes = new Map(prev.activeScrapes)
			const overall = { ...prev.overall }

			switch (event.type) {
				case "scan": {
					systems.set(event.system, {
						status: "scanning",
						total: event.romsFound,
						completed: 0,
						failed: 0,
						skipped: 0,
					})
					overall.totalSystems++
					overall.totalRoms += event.romsFound
					break
				}

				case "batch-start": {
					const sys = systems.get(event.system)
					if (sys) {
						sys.status = "scraping"
						sys.total = event.total
					}
					break
				}

				case "lookup": {
					const id = `${event.system}-${event.romFilename}`
					if (event.found) {
						const scrape: ScrapeItemState = {
							romFilename: event.romFilename,
							system: event.system,
							status: "lookup",
							...(event.gameTitle !== undefined
								? { gameTitle: event.gameTitle }
								: {}),
						}
						activeScrapes.set(id, scrape)
					}
					break
				}

				case "download": {
					const id = `${event.system}-${event.romFilename}`
					const scrape = activeScrapes.get(id)
					if (scrape) {
						if (event.status === "start") {
							const { error: _prevError, ...rest } = scrape
							activeScrapes.set(id, {
								...rest,
								status: "downloading",
								currentMedia: event.mediaType,
							})
						} else if (event.status === "error") {
							activeScrapes.set(id, {
								...scrape,
								status: "error",
								currentMedia: event.mediaType,
								error: event.error ?? "Download failed",
							})
						}
					}
					break
				}

				case "complete": {
					const id = `${event.system}-${event.romFilename}`
					activeScrapes.delete(id)
					const sys = systems.get(event.system)
					if (sys) {
						sys.completed++
					}
					overall.completedRoms++
					break
				}

				case "error": {
					// System-level error (no ROM filename) — ensure it shows up in UI
					if (!event.romFilename) {
						const existing = systems.get(event.system)
						if (existing) {
							existing.status = "error"
							existing.failed++
						} else {
							systems.set(event.system, {
								status: "error",
								total: 0,
								completed: 0,
								failed: 1,
								skipped: 0,
							})
							overall.totalSystems++
							overall.completedSystems++
						}
						overall.failedRoms++
						break
					}

					const id = `${event.system}-${event.romFilename}`
					const existing = activeScrapes.get(id)
					if (existing) {
						activeScrapes.set(id, {
							...existing,
							status: "error",
							error: event.error,
						})
					} else {
						activeScrapes.set(id, {
							romFilename: event.romFilename,
							system: event.system,
							status: "error",
							error: event.error,
						})
					}
					const sys = systems.get(event.system)
					if (sys) {
						sys.failed++
					}
					overall.failedRoms++
					overall.completedRoms++
					// Remove after delay
					setTimeout(() => {
						setState(s => {
							const as = new Map(s.activeScrapes)
							as.delete(id)
							return { ...s, activeScrapes: as }
						})
					}, 2000)
					break
				}

				case "batch-complete": {
					const sys = systems.get(event.system)
					if (sys) {
						sys.status = "complete"
						sys.completed = event.success
						sys.failed = event.failed
						sys.skipped = event.skipped
					}
					overall.completedRoms += event.skipped
					overall.completedSystems++
					break
				}
			}

			return { systems, activeScrapes, overall }
		})
	}, [])

	useEffect(() => {
		if (!options) return

		log.scrape.info(
			{
				systems: options.systemDirs.map(s => s.system),
				concurrency: options.concurrency,
				downloadConcurrency: options.downloadConcurrency,
				boxArt: options.boxArt,
				screenshot: options.screenshot,
				video: options.video,
			},
			"scrape started",
		)

		abortRef.current = false
		setIsRunning(true)
		setError(null)
		setFailures([])

		const run = async () => {
			try {
				for await (const event of scrapeArtwork(options)) {
					if (abortRef.current) break
					processEvent(event)
				}
			} catch (err) {
				log.scrape.error(
					{ error: err instanceof Error ? err.message : String(err) },
					"scrape crashed",
				)
				setError(err instanceof Error ? err.message : String(err))
			} finally {
				log.scrape.info("scrape finished")
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

	return { state, isRunning, error, abort, failures }
}
