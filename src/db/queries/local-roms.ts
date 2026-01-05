/**
 * Local ROMs Database Queries
 *
 * Operations for tracking downloaded ROMs in the local_roms table.
 * Links downloads to the remote catalog for update detection and search.
 */

import { eq, and, like, inArray } from "drizzle-orm"
import type { DbClient } from "../index.js"
import {
	localRoms,
	remoteRoms,
	type LocalRom,
	type NewLocalRom,
} from "../schema.js"

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface RecordDownloadParams {
	/** Full path to the downloaded file */
	localPath: string
	/** File size in bytes */
	fileSize: number
	/** System identifier (e.g., "GB", "GBA") */
	system: string
	/** Original filename (for remote_rom lookup) */
	filename: string
}

export interface RecordLocalFileParams {
	/** Full path to the local file */
	localPath: string
	/** File size in bytes */
	fileSize: number
	/** Catalog system identifier (e.g., "MD", "FC_CART") */
	system: string
	/** Catalog filename used for matching (usually the remote listing filename) */
	filename: string
	/** Optional SHA-1 hash */
	sha1?: string
	/** Optional CRC32 hash */
	crc32?: string
}

export interface PruneLocalRomsParams {
	/** Only consider DB rows whose localPath starts with this prefix. */
	prefix: string
	/** Set of localPaths that are known to exist (e.g. from a fresh filesystem scan). */
	keepPaths: ReadonlySet<string>
}

// ═══════════════════════════════════════════════════════════════════════════════
// Core Operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Record a downloaded ROM in the local_roms table.
 *
 * Performs an upsert based on localPath. If the ROM exists in the remote catalog
 * (remote_roms table), it will be linked via remoteRomId.
 *
 * @param db Database client
 * @param params Download details
 * @returns The inserted/updated local ROM record
 */
export function recordDownload(
	db: DbClient,
	params: RecordDownloadParams,
): LocalRom {
	const { localPath, fileSize, system, filename } = params
	const now = new Date().toISOString()

	// Try to find matching remote ROM for linking
	let remoteRomId: number | null = null
	const remoteMatch = db
		.select({ id: remoteRoms.id })
		.from(remoteRoms)
		.where(
			and(eq(remoteRoms.system, system), eq(remoteRoms.filename, filename)),
		)
		.get()

	if (remoteMatch) {
		remoteRomId = remoteMatch.id
	}

	// Check if local_rom entry already exists
	const existing = db
		.select()
		.from(localRoms)
		.where(eq(localRoms.localPath, localPath))
		.get()

	if (existing) {
		// Update existing record
		db.update(localRoms)
			.set({
				remoteRomId,
				system,
				filename,
				fileSize,
				downloadedAt: now,
			})
			.where(eq(localRoms.id, existing.id))
			.run()

		return {
			...existing,
			remoteRomId,
			system,
			filename,
			fileSize,
			downloadedAt: now,
		}
	}

	// Insert new record
	const newRecord: NewLocalRom = {
		localPath,
		fileSize,
		remoteRomId,
		system,
		filename,
		downloadedAt: now,
	}

	const result = db.insert(localRoms).values(newRecord).returning().get()
	return result
}

/**
 * Record a local file discovered by scanning the filesystem.
 *
 * This is intentionally conservative:
 * - Upserts by localPath
 * - Updates matching/linking fields (remoteRomId/system/filename/fileSize/hashes)
 * - Does NOT overwrite downloadedAt (scan shouldn't pretend it downloaded the file)
 */
export function recordLocalFile(db: DbClient, params: RecordLocalFileParams) {
	const { localPath, fileSize, system, filename, sha1, crc32 } = params

	// Try to find matching remote ROM for linking
	let remoteRomId: number | null = null
	const remoteMatch = db
		.select({ id: remoteRoms.id })
		.from(remoteRoms)
		.where(
			and(eq(remoteRoms.system, system), eq(remoteRoms.filename, filename)),
		)
		.get()

	if (remoteMatch) remoteRomId = remoteMatch.id

	const existing = db
		.select()
		.from(localRoms)
		.where(eq(localRoms.localPath, localPath))
		.get()

	if (existing) {
		db.update(localRoms)
			.set({
				remoteRomId,
				system,
				filename,
				fileSize,
				...(sha1 ? { sha1 } : {}),
				...(crc32 ? { crc32 } : {}),
				...(sha1 || crc32 ? { verifiedAt: new Date().toISOString() } : {}),
			})
			.where(eq(localRoms.id, existing.id))
			.run()

		return {
			...existing,
			remoteRomId,
			system,
			filename,
			fileSize,
			...(sha1 ? { sha1 } : {}),
			...(crc32 ? { crc32 } : {}),
			...(sha1 || crc32 ? { verifiedAt: new Date().toISOString() } : {}),
		}
	}

	const newRecord: NewLocalRom = {
		localPath,
		fileSize,
		remoteRomId,
		system,
		filename,
		...(sha1 ? { sha1 } : {}),
		...(crc32 ? { crc32 } : {}),
		...(sha1 || crc32 ? { verifiedAt: new Date().toISOString() } : {}),
	}

	return db.insert(localRoms).values(newRecord).returning().get()
}

/**
 * Find a local ROM by its path.
 *
 * @param db Database client
 * @param localPath Full path to the ROM file
 * @returns The local ROM record or null
 */
export function findLocalRom(db: DbClient, localPath: string): LocalRom | null {
	return (
		db
			.select()
			.from(localRoms)
			.where(eq(localRoms.localPath, localPath))
			.get() ?? null
	)
}

/**
 * Get all local ROMs for a system.
 *
 * @param db Database client
 * @param system System identifier
 * @returns Array of local ROM records with their remote catalog data
 */
export function getLocalRomsBySystem(db: DbClient, system: string): LocalRom[] {
	return db
		.select()
		.from(localRoms)
		.innerJoin(remoteRoms, eq(localRoms.remoteRomId, remoteRoms.id))
		.where(eq(remoteRoms.system, system))
		.all()
		.map(row => row.local_roms)
}

/**
 * Get count of local ROMs, optionally by system.
 *
 * @param db Database client
 * @param system Optional system filter
 * @returns Count of local ROMs
 */
export function getLocalRomCount(db: DbClient, system?: string): number {
	if (system) {
		return db
			.select()
			.from(localRoms)
			.innerJoin(remoteRoms, eq(localRoms.remoteRomId, remoteRoms.id))
			.where(eq(remoteRoms.system, system))
			.all().length
	}

	return db.select().from(localRoms).all().length
}

/**
 * Get local ROM statistics per system.
 *
 * @param db Database client
 * @returns Map of system -> count
 */
export function getLocalRomStats(db: DbClient): Map<string, number> {
	const rows = db
		.select({
			system: remoteRoms.system,
		})
		.from(localRoms)
		.innerJoin(remoteRoms, eq(localRoms.remoteRomId, remoteRoms.id))
		.all()

	const stats = new Map<string, number>()
	for (const row of rows) {
		const current = stats.get(row.system) ?? 0
		stats.set(row.system, current + 1)
	}

	return stats
}

/**
 * Prune stale local_roms rows whose localPath no longer exists.
 *
 * Intended to be used after a full filesystem scan. Callers pass a set of
 * scanned file paths, and this function removes DB rows under `prefix` that
 * are not present in that set.
 */
export function pruneLocalRoms(
	db: DbClient,
	params: PruneLocalRomsParams,
): {
	pruned: number
} {
	const normalizedPrefix = params.prefix.endsWith("/")
		? params.prefix
		: `${params.prefix}/`

	const rows = db
		.select({ id: localRoms.id, localPath: localRoms.localPath })
		.from(localRoms)
		.where(like(localRoms.localPath, `${normalizedPrefix}%`))
		.all()

	const idsToDelete: number[] = []
	for (const row of rows) {
		if (!params.keepPaths.has(row.localPath)) {
			idsToDelete.push(row.id)
		}
	}

	if (idsToDelete.length === 0) return { pruned: 0 }

	const CHUNK_SIZE = 500
	db.transaction(tx => {
		for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
			const chunk = idsToDelete.slice(i, i + CHUNK_SIZE)
			tx.delete(localRoms).where(inArray(localRoms.id, chunk)).run()
		}
	})

	return { pruned: idsToDelete.length }
}

/**
 * Check if a ROM has been downloaded (exists in local_roms table).
 *
 * @param db Database client
 * @param system System identifier
 * @param filename ROM filename
 * @returns true if the ROM exists locally
 */
export function isRomDownloaded(
	db: DbClient,
	system: string,
	filename: string,
): boolean {
	const remoteMatch = db
		.select({ id: remoteRoms.id })
		.from(remoteRoms)
		.where(
			and(eq(remoteRoms.system, system), eq(remoteRoms.filename, filename)),
		)
		.get()

	if (!remoteMatch) return false

	const localMatch = db
		.select({ id: localRoms.id })
		.from(localRoms)
		.where(eq(localRoms.remoteRomId, remoteMatch.id))
		.get()

	return !!localMatch
}
