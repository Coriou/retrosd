/**
 * React hook for consuming the catalog sync generator
 *
 * Bridges the async generator pattern with React state management.
 * Use this hook in Ink components to display sync progress.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import {
	syncCatalog,
	type CatalogSyncEvent,
	type SyncOptions,
} from "../../core/catalog-sync.js"
import { log } from "../../logger.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemSyncState {
	status:
		| "pending"
		| "fetching"
		| "parsing"
		| "syncing"
		| "complete"
		| "skipped"
		| "error"
	romCount: number
	inserted: number
	updated: number
	unchanged: number
	durationMs: number
	error?: string
	skipReason?: string
	source?: string
	label?: string
}

export interface SyncViewState {
	systems: Map<string, SystemSyncState>
	overall: {
		totalSystems: number
		completedSystems: number
		totalRoms: number
		startTime: number
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * React hook that runs the catalog sync generator and maintains UI state.
 *
 * @param options Sync configuration (null to defer start)
 * @returns Current sync state and control functions
 */
export function useCatalogSync(options: SyncOptions | null) {
	const [state, setState] = useState<SyncViewState>(() => ({
		systems: new Map(),
		overall: {
			totalSystems: 0,
			completedSystems: 0,
			totalRoms: 0,
			startTime: Date.now(),
		},
	}))

	const [isRunning, setIsRunning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const abortRef = useRef(false)

	const processEvent = useCallback((event: CatalogSyncEvent) => {
		setState(prev => {
			const systems = new Map(prev.systems)
			const overall = { ...prev.overall }

			switch (event.type) {
				case "sync:start": {
					overall.totalSystems = event.totalSystems
					overall.startTime = Date.now()
					// Initialize all systems as pending
					for (const system of event.systems) {
						systems.set(system, {
							status: "pending",
							romCount: 0,
							inserted: 0,
							updated: 0,
							unchanged: 0,
							durationMs: 0,
						})
					}
					break
				}

				case "system:start": {
					const existing = systems.get(event.system) ?? {
						status: "pending",
						romCount: 0,
						inserted: 0,
						updated: 0,
						unchanged: 0,
						durationMs: 0,
					}
					systems.set(event.system, {
						...existing,
						status: "fetching",
						source: event.source,
						label: event.label,
					})
					break
				}

				case "system:fetch": {
					const existing = systems.get(event.system)
					if (existing) {
						systems.set(event.system, {
							...existing,
							status: "fetching",
						})
					}
					break
				}

				case "system:parse": {
					const existing = systems.get(event.system)
					if (existing) {
						systems.set(event.system, {
							...existing,
							status: "parsing",
							romCount: event.totalRoms,
						})
					}
					break
				}

				case "system:insert": {
					const existing = systems.get(event.system)
					if (existing) {
						systems.set(event.system, {
							...existing,
							status: "syncing",
							inserted: event.inserted,
							updated: event.updated,
							unchanged: event.unchanged,
						})
					}
					break
				}

				case "system:complete": {
					const existing = systems.get(event.system)
					if (existing) {
						systems.set(event.system, {
							...existing,
							status: "complete",
							romCount: event.romCount,
							durationMs: event.durationMs,
						})
					}
					overall.completedSystems++
					overall.totalRoms += event.romCount
					break
				}

				case "system:skip": {
					const existing = systems.get(event.system)
					if (existing) {
						systems.set(event.system, {
							...existing,
							status: "skipped",
							skipReason: event.reason,
						})
					}
					overall.completedSystems++
					break
				}

				case "system:error": {
					const existing = systems.get(event.system)
					if (existing) {
						systems.set(event.system, {
							...existing,
							status: "error",
							error: event.error,
						})
					}
					overall.completedSystems++
					break
				}

				case "sync:complete": {
					// Final state update
					break
				}
			}

			return { systems, overall }
		})
	}, [])

	useEffect(() => {
		if (!options) return

		log.db.info(
			{
				systems: options.systems ?? ["all"],
				force: options.force ?? false,
				dbPath: options.dbPath,
			},
			"catalog sync started",
		)

		abortRef.current = false
		setIsRunning(true)
		setError(null)

		const run = async () => {
			try {
				for await (const event of syncCatalog(options)) {
					if (abortRef.current) break
					processEvent(event)
				}
			} catch (err) {
				log.db.error(
					{ error: err instanceof Error ? err.message : String(err) },
					"catalog sync crashed",
				)
				setError(err instanceof Error ? err.message : String(err))
			} finally {
				log.db.info("catalog sync finished")
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
