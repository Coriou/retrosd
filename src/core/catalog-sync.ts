/**
 * Catalog Sync Engine
 *
 * Syncs remote ROM listings (Myrient, etc.) to the local SQLite database.
 * Uses async generators for event-driven UI updates with backpressure control.
 *
 * Key features:
 * - Incremental sync using last-modified timestamps
 * - Batch transactions for performance
 * - Full metadata parsing using No-Intro naming conventions
 * - Event-driven progress reporting
 */

import { fetch as undiciFetch, Agent } from "undici"
import { eq, and, inArray } from "drizzle-orm"
import type { RomEntry, Source } from "../types.js"
import { ROM_ENTRIES } from "../roms.js"
import {
	parseListing,
	parseDirectoryLastModified,
	type FileEntry,
} from "../roms.js"
import { parseRomFilenameParts } from "../romname.js"
import { getDb, getSqlite, type DbClient } from "../db/index.js"
import {
	remoteRoms,
	romMetadata,
	syncState,
	type NewRemoteRom,
	type NewRomMetadata,
	type NewSyncState,
} from "../db/schema.js"

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SyncOptions {
	/** Path to the SQLite database */
	dbPath: string
	/** Systems to sync (empty = all) */
	systems?: string[]
	/** Force full resync ignoring timestamps */
	force?: boolean
}

/** Events emitted during catalog sync */
export type CatalogSyncEvent =
	| { type: "sync:start"; systems: string[]; totalSystems: number }
	| { type: "system:start"; system: string; source: Source; label: string }
	| { type: "system:fetch"; system: string }
	| { type: "system:parse"; system: string; totalRoms: number }
	| {
			type: "system:insert"
			system: string
			inserted: number
			updated: number
			unchanged: number
	  }
	| {
			type: "system:complete"
			system: string
			romCount: number
			durationMs: number
	  }
	| { type: "system:skip"; system: string; reason: string }
	| { type: "system:error"; system: string; error: string }
	| {
			type: "sync:complete"
			totalSystems: number
			totalRoms: number
			durationMs: number
	  }

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const SOURCE_URLS: Record<Source, string> = {
	"no-intro": "https://myrient.erista.me/files/No-Intro",
	redump: "https://myrient.erista.me/files/Redump",
}

const HTTP_AGENT = new Agent({
	keepAliveTimeout: 30_000,
	keepAliveMaxTimeout: 60_000,
	pipelining: 1,
})

/** Batch size for database transactions */
const BATCH_SIZE = 500

// ═══════════════════════════════════════════════════════════════════════════════
// Main Generator
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Async generator that syncs remote catalog to local database.
 *
 * Usage:
 * ```ts
 * for await (const event of syncCatalog(options)) {
 *   switch (event.type) {
 *     case 'sync:start': initProgress(event); break;
 *     case 'system:complete': updateProgress(event); break;
 *     // ...
 *   }
 * }
 * ```
 */
export async function* syncCatalog(
	options: SyncOptions,
): AsyncGenerator<CatalogSyncEvent> {
	const startTime = Date.now()
	const db = getDb(options.dbPath)

	// Resolve systems to sync
	const targetSystems = options.systems?.length
		? ROM_ENTRIES.filter(e => options.systems!.includes(e.key))
		: ROM_ENTRIES

	if (targetSystems.length === 0) {
		return
	}

	yield {
		type: "sync:start",
		systems: targetSystems.map(e => e.key),
		totalSystems: targetSystems.length,
	}

	let totalRoms = 0
	let syncedSystems = 0

	for (const entry of targetSystems) {
		try {
			let systemRoms = 0
			for await (const event of syncSystem(db, entry, options.force ?? false)) {
				yield event
				if (event.type === "system:complete") {
					systemRoms = event.romCount
					syncedSystems++
				}
			}
			totalRoms += systemRoms
		} catch (err) {
			yield {
				type: "system:error",
				system: entry.key,
				error: err instanceof Error ? err.message : String(err),
			}
		}
	}

	yield {
		type: "sync:complete",
		totalSystems: syncedSystems,
		totalRoms,
		durationMs: Date.now() - startTime,
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Per-System Sync
// ═══════════════════════════════════════════════════════════════════════════════

async function* syncSystem(
	db: DbClient,
	entry: RomEntry,
	force: boolean,
): AsyncGenerator<CatalogSyncEvent> {
	const startTime = Date.now()
	const { key: system, source, label } = entry

	yield { type: "system:start", system, source, label }

	// Check if we can skip (incremental sync)
	if (!force) {
		const existing = await db.query.syncState.findFirst({
			where: and(eq(syncState.system, system), eq(syncState.source, source)),
		})

		if (existing?.status === "synced" && existing.remoteLastModified) {
			// We'll check actual remote timestamp after fetch
		}
	}

	// Fetch remote listing
	yield { type: "system:fetch", system }

	const baseUrl = SOURCE_URLS[source]
	const listingUrl = `${baseUrl}/${entry.remotePath}`

	let html: string
	let directoryLastModified: string | undefined
	try {
		const response = await undiciFetch(listingUrl, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) retrosd-cli/1.0.0",
			},
			dispatcher: HTTP_AGENT,
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`)
		}

		html = await response.text()
		directoryLastModified = parseDirectoryLastModified(html)
	} catch (err) {
		yield {
			type: "system:error",
			system,
			error: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
		}
		return
	}

	// Check for incremental skip
	if (!force && directoryLastModified) {
		const existing = await db.query.syncState.findFirst({
			where: and(eq(syncState.system, system), eq(syncState.source, source)),
		})

		if (
			existing?.remoteLastModified === directoryLastModified &&
			existing?.status === "synced"
		) {
			yield {
				type: "system:skip",
				system,
				reason: "Directory unchanged since last sync",
			}
			return
		}
	}

	// Parse listing
	const listing = parseListing(html, entry.archiveRegex)

	yield { type: "system:parse", system, totalRoms: listing.length }

	if (listing.length === 0) {
		yield { type: "system:skip", system, reason: "No ROMs found in listing" }
		return
	}

	// Sync to database
	const stats = await syncListingToDb(db, entry, listing, directoryLastModified)

	yield {
		type: "system:insert",
		system,
		inserted: stats.inserted,
		updated: stats.updated,
		unchanged: stats.unchanged,
	}

	yield {
		type: "system:complete",
		system,
		romCount: listing.length,
		durationMs: Date.now() - startTime,
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Database Operations
// ═══════════════════════════════════════════════════════════════════════════════

interface SyncStats {
	inserted: number
	updated: number
	unchanged: number
}

async function syncListingToDb(
	db: DbClient,
	entry: RomEntry,
	listing: FileEntry[],
	directoryLastModified: string | undefined,
): Promise<SyncStats> {
	const { key: system, source } = entry
	const now = new Date().toISOString()

	// Get existing ROMs for this system/source
	const existingRoms = await db
		.select({
			id: remoteRoms.id,
			filename: remoteRoms.filename,
			lastModified: remoteRoms.lastModified,
		})
		.from(remoteRoms)
		.where(and(eq(remoteRoms.system, system), eq(remoteRoms.source, source)))

	const existingMap = new Map(existingRoms.map(r => [r.filename, r]))
	const existingFilenames = new Set(existingMap.keys())
	const incomingFilenames = new Set(listing.map(f => f.filename))

	let inserted = 0
	let updated = 0
	let unchanged = 0

	// Use raw SQLite for transaction control
	const sqlite = getSqlite()

	// Process in batches within a transaction
	sqlite.exec("BEGIN IMMEDIATE")

	try {
		// Prepare statements
		const insertRom = sqlite.prepare(`
			INSERT INTO remote_roms (system, source, filename, size, last_modified, last_synced_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`)

		const updateRom = sqlite.prepare(`
			UPDATE remote_roms SET size = ?, last_modified = ?, last_synced_at = ? WHERE id = ?
		`)

		const insertMetadata = sqlite.prepare(`
			INSERT INTO rom_metadata (
				remote_rom_id, title, regions, languages, revision,
				is_beta, is_demo, is_proto, is_sample,
				is_unlicensed, is_homebrew, is_hack, is_virtual, is_compilation
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)

		const updateMetadata = sqlite.prepare(`
			UPDATE rom_metadata SET
				title = ?, regions = ?, languages = ?, revision = ?,
				is_beta = ?, is_demo = ?, is_proto = ?, is_sample = ?,
				is_unlicensed = ?, is_homebrew = ?, is_hack = ?, is_virtual = ?, is_compilation = ?
			WHERE remote_rom_id = ?
		`)

		// Process each ROM
		for (const file of listing) {
			const existing = existingMap.get(file.filename)
			const parsed = parseRomFilenameParts(file.filename)
			const metadataValues = extractMetadataValues(parsed)

			if (!existing) {
				// Insert new ROM
				const result = insertRom.run(
					system,
					source,
					file.filename,
					file.size ?? null,
					file.lastModified ?? null,
					now,
				)
				const romId = result.lastInsertRowid as number

				// Insert metadata
				insertMetadata.run(
					romId,
					metadataValues.title,
					metadataValues.regions,
					metadataValues.languages,
					metadataValues.revision,
					metadataValues.isBeta ? 1 : 0,
					metadataValues.isDemo ? 1 : 0,
					metadataValues.isProto ? 1 : 0,
					metadataValues.isSample ? 1 : 0,
					metadataValues.isUnlicensed ? 1 : 0,
					metadataValues.isHomebrew ? 1 : 0,
					metadataValues.isHack ? 1 : 0,
					metadataValues.isVirtual ? 1 : 0,
					metadataValues.isCompilation ? 1 : 0,
				)

				inserted++
			} else if (file.lastModified !== existing.lastModified) {
				// Update existing ROM
				updateRom.run(
					file.size ?? null,
					file.lastModified ?? null,
					now,
					existing.id,
				)

				// Update metadata
				updateMetadata.run(
					metadataValues.title,
					metadataValues.regions,
					metadataValues.languages,
					metadataValues.revision,
					metadataValues.isBeta ? 1 : 0,
					metadataValues.isDemo ? 1 : 0,
					metadataValues.isProto ? 1 : 0,
					metadataValues.isSample ? 1 : 0,
					metadataValues.isUnlicensed ? 1 : 0,
					metadataValues.isHomebrew ? 1 : 0,
					metadataValues.isHack ? 1 : 0,
					metadataValues.isVirtual ? 1 : 0,
					metadataValues.isCompilation ? 1 : 0,
					existing.id,
				)

				updated++
			} else {
				unchanged++
			}
		}

		// Delete ROMs that no longer exist in remote
		const toDelete = [...existingFilenames].filter(
			f => !incomingFilenames.has(f),
		)
		if (toDelete.length > 0) {
			// Get IDs to delete (cascades to metadata)
			const idsToDelete = toDelete
				.map(f => existingMap.get(f)?.id)
				.filter((id): id is number => id !== undefined)

			if (idsToDelete.length > 0) {
				// Delete in batches to avoid SQL parameter limits
				for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
					const batch = idsToDelete.slice(i, i + BATCH_SIZE)
					const placeholders = batch.map(() => "?").join(",")
					sqlite
						.prepare(`DELETE FROM remote_roms WHERE id IN (${placeholders})`)
						.run(...batch)
				}
			}
		}

		// Update sync state
		const existingSyncState = sqlite
			.prepare(`SELECT id FROM sync_state WHERE system = ? AND source = ?`)
			.get(system, source) as { id: number } | undefined

		if (existingSyncState) {
			sqlite
				.prepare(
					`UPDATE sync_state SET
						remote_last_modified = ?,
						local_last_synced = ?,
						remote_count = ?,
						status = ?,
						last_error = NULL
					WHERE id = ?`,
				)
				.run(
					directoryLastModified ?? null,
					now,
					listing.length,
					"synced",
					existingSyncState.id,
				)
		} else {
			sqlite
				.prepare(
					`INSERT INTO sync_state (system, source, remote_last_modified, local_last_synced, remote_count, status)
					VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.run(
					system,
					source,
					directoryLastModified ?? null,
					now,
					listing.length,
					"synced",
				)
		}

		sqlite.exec("COMMIT")
	} catch (err) {
		sqlite.exec("ROLLBACK")
		throw err
	}

	return { inserted, updated, unchanged }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

interface MetadataValues {
	title: string | null
	regions: string | null
	languages: string | null
	revision: number | null
	isBeta: boolean
	isDemo: boolean
	isProto: boolean
	isSample: boolean
	isUnlicensed: boolean
	isHomebrew: boolean
	isHack: boolean
	isVirtual: boolean
	isCompilation: boolean
}

function extractMetadataValues(
	parsed: ReturnType<typeof parseRomFilenameParts>,
): MetadataValues {
	const tags = parsed.tags.map(t => t.toLowerCase())
	// Extract revision from version parts (e.g., "Rev 1" -> parts[0] = 1)
	const revision = parsed.versionInfo?.parts?.[0] ?? null

	return {
		title: parsed.title || null,
		regions: parsed.regions.length > 0 ? JSON.stringify(parsed.regions) : null,
		languages:
			parsed.languages.length > 0 ? JSON.stringify(parsed.languages) : null,
		revision,
		isBeta: tags.includes("beta"),
		isDemo: tags.includes("demo"),
		isProto: tags.includes("proto") || tags.includes("prototype"),
		isSample: tags.includes("sample"),
		isUnlicensed: parsed.flags.unlicensed || tags.includes("unl"),
		isHomebrew: parsed.flags.homebrew,
		isHack: parsed.flags.hack,
		isVirtual: tags.includes("virtual console"),
		isCompilation: tags.includes("compilation"),
	}
}

/**
 * Get sync state for all systems
 */
export async function getSyncStates(dbPath: string) {
	const db = getDb(dbPath)
	return db.select().from(syncState)
}

/**
 * Get ROM count per system from local catalog
 */
export async function getCatalogStats(dbPath: string) {
	const db = getDb(dbPath)
	const sqlite = getSqlite()

	const stats = sqlite
		.prepare(
			`SELECT system, source, COUNT(*) as count, SUM(size) as totalSize
			 FROM remote_roms
			 GROUP BY system, source
			 ORDER BY system`,
		)
		.all() as Array<{
		system: string
		source: string
		count: number
		totalSize: number
	}>

	return stats
}
