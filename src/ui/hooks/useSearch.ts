/**
 * React hook for ROM catalog search
 *
 * Provides search functionality with debouncing and pagination.
 * Uses the SQLite-backed search queries for instant results.
 *
 * @module ui/hooks/useSearch
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { getDb, type DbClient } from "../../db/index.js"
import {
	searchRoms,
	countSearchResults,
	getCatalogStats,
	getSyncedSystems,
	getAllRegions,
	type SearchOptions,
	type SearchResult,
	type CatalogStats,
} from "../../db/queries/search.js"
import { log } from "../../logger.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseSearchOptions {
	/** Path to the database file */
	dbPath: string
	/** Initial search query */
	initialQuery?: string
	/** Initial system filters */
	initialSystems?: string[]
	/** Results per page */
	pageSize?: number
}

export interface UseSearchResult {
	/** Current search results */
	results: SearchResult[]
	/** Total count of matching ROMs */
	totalCount: number
	/** Whether a search is in progress */
	isLoading: boolean
	/** Current search error (if any) */
	error: string | null
	/** Catalog statistics */
	stats: CatalogStats | null
	/** All available systems in catalog */
	availableSystems: string[]
	/** All available regions in catalog */
	availableRegions: string[]
	/** Current search options */
	searchOptions: SearchOptions
	/** Current page (0-indexed) */
	currentPage: number
	/** Total number of pages */
	totalPages: number
	/** Update the search query */
	setQuery: (query: string) => void
	/** Update system filters */
	setSystems: (systems: string[]) => void
	/** Update region filters */
	setRegions: (regions: string[]) => void
	/** Toggle local-only filter */
	setLocalOnly: (localOnly: boolean) => void
	/** Toggle prerelease exclusion */
	setExcludePrerelease: (exclude: boolean) => void
	/** Go to next page */
	nextPage: () => void
	/** Go to previous page */
	prevPage: () => void
	/** Go to specific page */
	goToPage: (page: number) => void
	/** Refresh search (re-run with current options) */
	refresh: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * React hook for searching the ROM catalog.
 *
 * @param options Hook options
 * @returns Search state and control functions
 */
export function useSearch(options: UseSearchOptions): UseSearchResult {
	const {
		dbPath,
		initialQuery = "",
		initialSystems = [],
		pageSize = 25,
	} = options

	// Database instance (memoized)
	const db = useMemo<DbClient | null>(() => {
		try {
			return getDb(dbPath)
		} catch (err) {
			log.db.error({ error: err, dbPath }, "failed to connect to database")
			return null
		}
	}, [dbPath])

	// Search state - use spread to only include defined properties
	const [searchOptions, setSearchOptions] = useState<SearchOptions>(() => {
		const opts: SearchOptions = {
			query: initialQuery,
			excludePrerelease: true,
			limit: pageSize,
			offset: 0,
		}
		if (initialSystems.length > 0) {
			opts.systems = initialSystems
		}
		return opts
	})

	const [results, setResults] = useState<SearchResult[]>([])
	const [totalCount, setTotalCount] = useState(0)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Catalog metadata
	const [stats, setStats] = useState<CatalogStats | null>(null)
	const [availableSystems, setAvailableSystems] = useState<string[]>([])
	const [availableRegions, setAvailableRegions] = useState<string[]>([])

	// Page calculation
	const currentPage = Math.floor((searchOptions.offset ?? 0) / pageSize)
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

	// Debounce ref for query changes
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Load catalog metadata on mount
	useEffect(() => {
		if (!db) {
			setError("Database not initialized")
			return
		}

		try {
			setStats(getCatalogStats(db))
			setAvailableSystems(getSyncedSystems(db))
			setAvailableRegions(getAllRegions(db))
		} catch (err) {
			log.db.error({ error: err }, "failed to load catalog stats")
		}
	}, [db])

	// Execute search
	const executeSearch = useCallback(
		(opts: SearchOptions) => {
			if (!db) {
				setError("Database not initialized")
				return
			}

			setIsLoading(true)
			setError(null)

			try {
				const searchResults = searchRoms(db, opts)
				const count = countSearchResults(db, opts)

				setResults(searchResults)
				setTotalCount(count)

				log.db.debug(
					{
						query: opts.query,
						systems: opts.systems,
						resultCount: searchResults.length,
						totalCount: count,
					},
					"search completed",
				)
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				log.db.error({ error: err, options: opts }, "search failed")
				setError(message)
				setResults([])
				setTotalCount(0)
			} finally {
				setIsLoading(false)
			}
		},
		[db],
	)

	// Run search when options change
	useEffect(() => {
		executeSearch(searchOptions)
	}, [searchOptions, executeSearch])

	// Control functions
	const setQuery = useCallback((query: string) => {
		// Debounce query changes
		if (debounceRef.current) {
			clearTimeout(debounceRef.current)
		}

		debounceRef.current = setTimeout(() => {
			setSearchOptions(prev => ({
				...prev,
				query,
				offset: 0, // Reset to first page
			}))
		}, 150)
	}, [])

	const setSystems = useCallback((systems: string[]) => {
		setSearchOptions(prev => {
			const next: SearchOptions = { ...prev, offset: 0 }
			if (systems.length > 0) {
				next.systems = systems
			} else {
				delete next.systems
			}
			return next
		})
	}, [])

	const setRegions = useCallback((regions: string[]) => {
		setSearchOptions(prev => {
			const next: SearchOptions = { ...prev, offset: 0 }
			if (regions.length > 0) {
				next.regions = regions
			} else {
				delete next.regions
			}
			return next
		})
	}, [])

	const setLocalOnly = useCallback((localOnly: boolean) => {
		setSearchOptions(prev => ({
			...prev,
			localOnly,
			offset: 0,
		}))
	}, [])

	const setExcludePrerelease = useCallback((exclude: boolean) => {
		setSearchOptions(prev => ({
			...prev,
			excludePrerelease: exclude,
			offset: 0,
		}))
	}, [])

	const nextPage = useCallback(() => {
		setSearchOptions(prev => {
			const newOffset = (prev.offset ?? 0) + pageSize
			if (newOffset >= totalCount) return prev
			return { ...prev, offset: newOffset }
		})
	}, [pageSize, totalCount])

	const prevPage = useCallback(() => {
		setSearchOptions(prev => {
			const newOffset = Math.max(0, (prev.offset ?? 0) - pageSize)
			return { ...prev, offset: newOffset }
		})
	}, [pageSize])

	const goToPage = useCallback(
		(page: number) => {
			const offset = Math.max(0, Math.min(page * pageSize, totalCount - 1))
			setSearchOptions(prev => ({ ...prev, offset }))
		},
		[pageSize, totalCount],
	)

	const refresh = useCallback(() => {
		executeSearch(searchOptions)
	}, [executeSearch, searchOptions])

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current)
			}
		}
	}, [])

	return {
		results,
		totalCount,
		isLoading,
		error,
		stats,
		availableSystems,
		availableRegions,
		searchOptions,
		currentPage,
		totalPages,
		setQuery,
		setSystems,
		setRegions,
		setLocalOnly,
		setExcludePrerelease,
		nextPage,
		prevPage,
		goToPage,
		refresh,
	}
}
