/**
 * Database Stats Queries
 *
 * Lightweight helpers for surfacing SQLite catalog health in CLI/UI.
 *
 * @module db/queries/stats
 */

import { sql } from "drizzle-orm"
import type { DbClient } from "../index.js"
import { remoteRoms, romMetadata, localRoms, syncState } from "../schema.js"
import { getCatalogStats, type CatalogStats } from "./search.js"

export interface SyncStatusSummary {
	/** Number of system+source rows tracked in sync_state */
	totalEntries: number
	/** Number of unique systems tracked in sync_state */
	systemsTracked: number
	/** Status counts by sync_state.status */
	statusCounts: {
		synced: number
		stale: number
		syncing: number
		error: number
		other: number
	}
	/** Latest localLastSynced timestamp across sync_state */
	lastSyncedAt: string | null
}

export interface DbRowCounts {
	remoteRoms: number
	romMetadata: number
	localRoms: number
	syncState: number
}

export interface DbStats {
	catalog: CatalogStats
	counts: DbRowCounts
	sync: SyncStatusSummary
}

/**
 * Collect high-level database stats.
 *
 * Note: Callers should catch errors to handle missing tables (e.g., db exists but migrations not run).
 */
export function getDbStats(db: DbClient): DbStats {
	const catalog = getCatalogStats(db)

	const counts: DbRowCounts = {
		remoteRoms:
			db
				.select({ count: sql<number>`COUNT(${remoteRoms.id})` })
				.from(remoteRoms)
				.get()?.count ?? 0,
		romMetadata:
			db
				.select({ count: sql<number>`COUNT(${romMetadata.id})` })
				.from(romMetadata)
				.get()?.count ?? 0,
		localRoms:
			db
				.select({ count: sql<number>`COUNT(${localRoms.id})` })
				.from(localRoms)
				.get()?.count ?? 0,
		syncState:
			db
				.select({ count: sql<number>`COUNT(${syncState.id})` })
				.from(syncState)
				.get()?.count ?? 0,
	}

	const distinctSystems = db
		.select({ count: sql<number>`COUNT(DISTINCT ${syncState.system})` })
		.from(syncState)
		.get()?.count

	const statusRows = db
		.select({
			status: syncState.status,
			count: sql<number>`COUNT(*)`,
		})
		.from(syncState)
		.groupBy(syncState.status)
		.all()

	const statusCounts = {
		synced: 0,
		stale: 0,
		syncing: 0,
		error: 0,
		other: 0,
	}

	for (const row of statusRows) {
		const status = (row.status ?? "").toLowerCase()
		if (status === "synced") statusCounts.synced += row.count
		else if (status === "stale") statusCounts.stale += row.count
		else if (status === "syncing") statusCounts.syncing += row.count
		else if (status === "error") statusCounts.error += row.count
		else statusCounts.other += row.count
	}

	const lastSyncedAt =
		db
			.select({ last: sql<string | null>`MAX(${syncState.localLastSynced})` })
			.from(syncState)
			.get()?.last ?? null

	return {
		catalog,
		counts,
		sync: {
			totalEntries: counts.syncState,
			systemsTracked: distinctSystems ?? 0,
			statusCounts,
			lastSyncedAt,
		},
	}
}
