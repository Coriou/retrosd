/**
 * ROM Search Queries
 *
 * Provides full-text-style search across the synced ROM catalog.
 * Supports filtering by system, region, release type, and local availability.
 *
 * @module db/queries/search
 */

import {
	sql,
	eq,
	and,
	or,
	like,
	inArray,
	isNotNull,
	type SQL,
} from "drizzle-orm"
import type { DbClient } from "../index.js"
import { remoteRoms, romMetadata, localRoms } from "../schema.js"

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Search options for querying the ROM catalog.
 */
export interface SearchOptions {
	/** Text query to match against title/filename (case-insensitive) */
	query?: string
	/** Filter to specific systems (e.g., ["GB", "GBA"]) */
	systems?: string[]
	/** Filter to specific regions (e.g., ["USA", "Europe"]) */
	regions?: string[]
	/** Exclude pre-release ROMs (beta, demo, proto, sample) */
	excludePrerelease?: boolean
	/** Exclude unlicensed ROMs */
	excludeUnlicensed?: boolean
	/** Exclude hacks and homebrew */
	excludeHacksHomebrew?: boolean
	/** Only include ROMs that exist locally (downloaded) */
	localOnly?: boolean
	/** Maximum number of results */
	limit?: number
	/** Pagination offset */
	offset?: number
}

/**
 * A search result combining remote catalog data with metadata and local status.
 */
export interface SearchResult {
	/** Remote ROM ID (primary key) */
	id: number
	/** System identifier */
	system: string
	/** Source identifier (e.g., "myrient") */
	source: string
	/** Remote filename */
	filename: string
	/** File size in bytes */
	size: number | null
	/** Parsed game title */
	title: string | null
	/** Regions array */
	regions: string[] | null
	/** Languages array */
	languages: string[] | null
	/** Revision number */
	revision: number | null
	/** Pre-release flags */
	isBeta: boolean
	isDemo: boolean
	isProto: boolean
	/** Special ROM type flags */
	isUnlicensed: boolean
	isHomebrew: boolean
	isHack: boolean
	/** Whether the ROM has been downloaded locally */
	isLocal: boolean
	/** Local path if downloaded */
	localPath: string | null
	/** Local SHA-1 when available (typically after scan --hashes) */
	localSha1: string | null
	/** Local CRC32 when available (typically after scan --hashes) */
	localCrc32: string | null
}

/**
 * Summary statistics for the search catalog.
 */
export interface CatalogStats {
	/** Total number of ROMs in catalog */
	totalRoms: number
	/** Number of systems with synced ROMs */
	systemCount: number
	/** Number of locally downloaded ROMs */
	localRoms: number
	/** Per-system counts */
	systemStats: { system: string; count: number; localCount: number }[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// Search Query
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Search the ROM catalog with filtering and pagination.
 *
 * @param db Database client
 * @param options Search options
 * @returns Array of matching ROMs
 */
export function searchRoms(
	db: DbClient,
	options: SearchOptions,
): SearchResult[] {
	const {
		query,
		systems,
		regions,
		excludePrerelease = false,
		excludeUnlicensed = false,
		excludeHacksHomebrew = false,
		localOnly = false,
		limit = 50,
		offset = 0,
	} = options

	const localExists = sql<number>`EXISTS(
		SELECT 1 FROM local_roms lr
		WHERE lr.remote_rom_id = ${remoteRoms.id}
			OR (
				lr.system IS NOT NULL AND lr.filename IS NOT NULL
				AND lr.system = ${remoteRoms.system}
				AND lr.filename = ${remoteRoms.filename}
			)
	)`

	const localPathExpr = sql<string | null>`(
		SELECT lr.local_path FROM local_roms lr
		WHERE lr.remote_rom_id = ${remoteRoms.id}
			OR (
				lr.system IS NOT NULL AND lr.filename IS NOT NULL
				AND lr.system = ${remoteRoms.system}
				AND lr.filename = ${remoteRoms.filename}
			)
		ORDER BY lr.downloaded_at DESC, lr.id DESC
		LIMIT 1
	)`

	const localSha1Expr = sql<string | null>`(
		SELECT lr.sha1 FROM local_roms lr
		WHERE lr.remote_rom_id = ${remoteRoms.id}
			OR (
				lr.system IS NOT NULL AND lr.filename IS NOT NULL
				AND lr.system = ${remoteRoms.system}
				AND lr.filename = ${remoteRoms.filename}
			)
		ORDER BY lr.downloaded_at DESC, lr.id DESC
		LIMIT 1
	)`

	const localCrc32Expr = sql<string | null>`(
		SELECT lr.crc32 FROM local_roms lr
		WHERE lr.remote_rom_id = ${remoteRoms.id}
			OR (
				lr.system IS NOT NULL AND lr.filename IS NOT NULL
				AND lr.system = ${remoteRoms.system}
				AND lr.filename = ${remoteRoms.filename}
			)
		ORDER BY lr.downloaded_at DESC, lr.id DESC
		LIMIT 1
	)`

	// Build dynamic WHERE conditions
	const conditions: SQL[] = []

	// System filter
	if (systems && systems.length > 0) {
		conditions.push(inArray(remoteRoms.system, systems))
	}

	// Text search (title or filename)
	if (query && query.trim()) {
		const pattern = `%${query.trim()}%`
		conditions.push(
			or(like(romMetadata.title, pattern), like(remoteRoms.filename, pattern))!,
		)
	}

	// Region filter (JSON array contains)
	if (regions && regions.length > 0) {
		// Match any of the specified regions in the JSON array
		const regionConditions = regions.map(region =>
			like(romMetadata.regions, `%"${region}"%`),
		)
		conditions.push(or(...regionConditions)!)
	}

	// Pre-release exclusion
	if (excludePrerelease) {
		conditions.push(eq(romMetadata.isBeta, false))
		conditions.push(eq(romMetadata.isDemo, false))
		conditions.push(eq(romMetadata.isProto, false))
		conditions.push(eq(romMetadata.isSample, false))
	}

	// Unlicensed exclusion
	if (excludeUnlicensed) {
		conditions.push(eq(romMetadata.isUnlicensed, false))
	}

	// Hacks/homebrew exclusion
	if (excludeHacksHomebrew) {
		conditions.push(eq(romMetadata.isHack, false))
		conditions.push(eq(romMetadata.isHomebrew, false))
	}

	// Local-only filter
	if (localOnly) {
		conditions.push(localExists)
	}

	// Build the query (local status via correlated subqueries)
	const baseQuery = db
		.select({
			id: remoteRoms.id,
			system: remoteRoms.system,
			source: remoteRoms.source,
			filename: remoteRoms.filename,
			size: remoteRoms.size,
			title: romMetadata.title,
			regions: romMetadata.regions,
			languages: romMetadata.languages,
			revision: romMetadata.revision,
			isBeta: romMetadata.isBeta,
			isDemo: romMetadata.isDemo,
			isProto: romMetadata.isProto,
			isUnlicensed: romMetadata.isUnlicensed,
			isHomebrew: romMetadata.isHomebrew,
			isHack: romMetadata.isHack,
			isLocal: localExists,
			localPath: localPathExpr,
			localSha1: localSha1Expr,
			localCrc32: localCrc32Expr,
		})
		.from(remoteRoms)
		.innerJoin(romMetadata, eq(romMetadata.remoteRomId, remoteRoms.id))

	// Apply conditions
	const withConditions =
		conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery

	// Order by title (with query match priority), then system
	const ordered = query
		? withConditions.orderBy(
				// Exact prefix matches first
				sql`CASE WHEN LOWER(${romMetadata.title}) LIKE ${query.toLowerCase() + "%"} THEN 0 ELSE 1 END`,
				romMetadata.title,
				remoteRoms.system,
			)
		: withConditions.orderBy(romMetadata.title, remoteRoms.system)

	// Apply pagination
	const results = ordered.limit(limit).offset(offset).all()

	// Transform to SearchResult format
	return results.map(row => ({
		id: row.id,
		system: row.system,
		source: row.source,
		filename: row.filename,
		size: row.size,
		title: row.title,
		regions: row.regions ?? null,
		languages: row.languages ?? null,
		revision: row.revision,
		isBeta: row.isBeta ?? false,
		isDemo: row.isDemo ?? false,
		isProto: row.isProto ?? false,
		isUnlicensed: row.isUnlicensed ?? false,
		isHomebrew: row.isHomebrew ?? false,
		isHack: row.isHack ?? false,
		isLocal: (row.isLocal ?? 0) === 1,
		localPath: row.localPath,
		localSha1: row.localSha1 ?? null,
		localCrc32: row.localCrc32 ?? null,
	}))
}

/**
 * Collapse local search results that refer to byte-identical ROMs.
 *
 * This only collapses results when a local hash is present, and it only
 * dedupes within the same system to avoid cross-system surprises.
 */
export function collapseSearchResultsByHash(
	results: SearchResult[],
): SearchResult[] {
	const seen = new Set<string>()
	const out: SearchResult[] = []

	for (const result of results) {
		if (!result.isLocal) {
			out.push(result)
			continue
		}

		const hash = result.localSha1 ?? result.localCrc32
		if (!hash) {
			out.push(result)
			continue
		}

		const key = `${result.system}|${hash}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push(result)
	}

	return out
}

/**
 * Count total results matching the search options (for pagination).
 *
 * @param db Database client
 * @param options Search options (limit/offset ignored)
 * @returns Total count of matching ROMs
 */
export function countSearchResults(
	db: DbClient,
	options: Omit<SearchOptions, "limit" | "offset">,
): number {
	const {
		query,
		systems,
		regions,
		excludePrerelease = false,
		excludeUnlicensed = false,
		excludeHacksHomebrew = false,
		localOnly = false,
	} = options

	const localExists = sql<number>`EXISTS(
		SELECT 1 FROM local_roms lr
		WHERE lr.remote_rom_id = ${remoteRoms.id}
			OR (
				lr.system IS NOT NULL AND lr.filename IS NOT NULL
				AND lr.system = ${remoteRoms.system}
				AND lr.filename = ${remoteRoms.filename}
			)
	)`

	const conditions: SQL[] = []

	if (systems && systems.length > 0) {
		conditions.push(inArray(remoteRoms.system, systems))
	}

	if (query && query.trim()) {
		const pattern = `%${query.trim()}%`
		conditions.push(
			or(like(romMetadata.title, pattern), like(remoteRoms.filename, pattern))!,
		)
	}

	if (regions && regions.length > 0) {
		const regionConditions = regions.map(region =>
			like(romMetadata.regions, `%"${region}"%`),
		)
		conditions.push(or(...regionConditions)!)
	}

	if (excludePrerelease) {
		conditions.push(eq(romMetadata.isBeta, false))
		conditions.push(eq(romMetadata.isDemo, false))
		conditions.push(eq(romMetadata.isProto, false))
		conditions.push(eq(romMetadata.isSample, false))
	}

	if (excludeUnlicensed) {
		conditions.push(eq(romMetadata.isUnlicensed, false))
	}

	if (excludeHacksHomebrew) {
		conditions.push(eq(romMetadata.isHack, false))
		conditions.push(eq(romMetadata.isHomebrew, false))
	}

	if (localOnly) {
		conditions.push(localExists)
	}

	const baseQuery = db
		.select({ count: sql<number>`COUNT(*)` })
		.from(remoteRoms)
		.innerJoin(romMetadata, eq(romMetadata.remoteRomId, remoteRoms.id))

	const result =
		conditions.length > 0
			? baseQuery.where(and(...conditions)).get()
			: baseQuery.get()

	return result?.count ?? 0
}

// ═══════════════════════════════════════════════════════════════════════════════
// Catalog Statistics
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get summary statistics for the ROM catalog.
 *
 * @param db Database client
 * @returns Catalog statistics
 */
export function getCatalogStats(db: DbClient): CatalogStats {
	// Get per-system ROM counts
	const systemCounts = db
		.select({
			system: remoteRoms.system,
			count: sql<number>`COUNT(${remoteRoms.id})`,
		})
		.from(remoteRoms)
		.groupBy(remoteRoms.system)
		.orderBy(remoteRoms.system)
		.all()

	// Get per-system local counts (match the same semantics as search):
	// - linked by remoteRomId, OR
	// - fallback match by (system, filename)
	const localCounts = db
		.select({
			system: remoteRoms.system,
			count: sql<number>`COUNT(*)`,
		})
		.from(remoteRoms)
		.where(
			sql`EXISTS (
				SELECT 1 FROM ${localRoms}
				WHERE ${localRoms.remoteRomId} = ${remoteRoms.id}
				   OR (${localRoms.system} = ${remoteRoms.system} AND ${localRoms.filename} = ${remoteRoms.filename})
			)`,
		)
		.groupBy(remoteRoms.system)
		.all()

	const localCountMap = new Map(localCounts.map(r => [r.system, r.count]))

	// Calculate totals
	let totalRoms = 0
	let localRomsCount = 0

	const systemStats = systemCounts.map(({ system, count }) => {
		const localCount = localCountMap.get(system) ?? 0
		totalRoms += count
		localRomsCount += localCount
		return { system, count, localCount }
	})

	return {
		totalRoms,
		systemCount: systemCounts.length,
		localRoms: localRomsCount,
		systemStats,
	}
}

/**
 * Get list of all synced systems.
 *
 * @param db Database client
 * @returns Array of system identifiers
 */
export function getSyncedSystems(db: DbClient): string[] {
	const rows = db
		.selectDistinct({ system: remoteRoms.system })
		.from(remoteRoms)
		.orderBy(remoteRoms.system)
		.all()

	return rows.map(r => r.system)
}

/**
 * Get list of all unique regions in the catalog.
 *
 * @param db Database client
 * @returns Array of region codes
 */
export function getAllRegions(db: DbClient): string[] {
	// This is a bit tricky with JSON arrays; we'll use a distinct query on parsed values
	const rows = db
		.selectDistinct({ regions: romMetadata.regions })
		.from(romMetadata)
		.where(isNotNull(romMetadata.regions))
		.all()

	const regionsSet = new Set<string>()
	for (const row of rows) {
		if (Array.isArray(row.regions)) {
			for (const region of row.regions) {
				regionsSet.add(region)
			}
		}
	}

	return Array.from(regionsSet).sort()
}
