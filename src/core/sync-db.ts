/**
 * sync-db
 *
 * Efficiently sync both:
 * - Remote catalogs into the local SQLite database ("sync")
 * - Local filesystem ROM presence into local_roms ("scan" reconciliation)
 *
 * Design goals:
 * - Parallelize the expensive I/O phases (network sync + filesystem scan)
 * - Avoid concurrent SQLite write contention by doing local_roms reconciliation
 *   after the remote sync completes.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { ui } from "../ui.js"
import type { CollectionManifest } from "../types.js"
import type { SyncOptions } from "./catalog-sync.js"

export interface SyncDbOptions {
	/** Path to SD card root directory (contains Bios/ and Roms/) */
	targetDir: string
	/** Resolved path to the SQLite database */
	dbPath: string
	/** Systems to process (empty/undefined = all) */
	systems?: string[]
	/** Force full remote resync */
	force?: boolean
	/** Suppress most output */
	quiet?: boolean
	/** Print per-system detail */
	verbose?: boolean
}

export interface SyncDbResult {
	ok: boolean
	scan: {
		romsFound: number
		systemsFound: number
		durationMs: number
	}
	remote: {
		totalRomsIndexed: number
		systemsProcessed: number
		errors: number
		durationMs: number
	}
	local: {
		recorded: number
		pruned: number
		durationMs: number
	}
	elapsedMs: number
}

function nowMs(): number {
	return performance.now()
}

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

async function runRemoteSync(options: {
	dbPath: string
	systems?: string[]
	force?: boolean
	quiet: boolean
	verbose: boolean
}): Promise<SyncDbResult["remote"]> {
	const start = nowMs()
	const { syncCatalog } = await import("./catalog-sync.js")
	const systems =
		options.systems && options.systems.length > 0 ? options.systems : undefined

	const syncOptions: SyncOptions = {
		dbPath: options.dbPath,
		...(systems ? { systems } : {}),
		...(typeof options.force === "boolean" ? { force: options.force } : {}),
	}

	let totalRomsIndexed = 0
	let systemsProcessed = 0
	let errors = 0

	for await (const event of syncCatalog(syncOptions)) {
		switch (event.type) {
			case "system:complete":
				systemsProcessed += 1
				totalRomsIndexed += event.romCount
				if (!options.quiet && options.verbose) {
					ui.success(
						`Remote: ${event.system} ${event.romCount.toLocaleString()} ROMs (${(
							event.durationMs / 1000
						).toFixed(1)}s)`,
					)
				}
				break
			case "system:error":
				errors += 1
				if (!options.quiet) {
					ui.error(`Remote: ${event.system}: ${event.error}`)
				}
				break
			case "system:skip":
				if (!options.quiet && options.verbose) {
					ui.info(`Remote: ${event.system}: ${event.reason}`)
				}
				break
			case "system:start":
				if (!options.quiet && options.verbose) {
					ui.info(`Remote: ${event.system}: fetching ${event.label}…`)
				}
				break
			default:
				break
		}
	}

	return {
		totalRomsIndexed,
		systemsProcessed,
		errors,
		durationMs: Math.round(nowMs() - start),
	}
}

async function runLocalScan(options: {
	romsDir: string
	systems?: string[]
	quiet: boolean
	verbose: boolean
}): Promise<{ manifest: CollectionManifest } & SyncDbResult["scan"]> {
	const start = nowMs()
	const { scanCollection } = await import("../collection.js")
	const systems =
		options.systems && options.systems.length > 0 ? options.systems : undefined

	const manifest = await scanCollection(options.romsDir, {
		includeHashes: false,
		...(systems ? { systems } : {}),
		verbose: options.verbose,
		quiet: true, // never print during sync-db; we control output here
	})

	return {
		manifest,
		romsFound: manifest.stats.totalRoms,
		systemsFound: manifest.stats.systemCount,
		durationMs: Math.round(nowMs() - start),
	}
}

async function reconcileLocalRomsToDb(options: {
	manifest: CollectionManifest
	romsDir: string
	dbPath: string
	quiet: boolean
	verbose: boolean
}): Promise<SyncDbResult["local"]> {
	const start = nowMs()
	const { getDb, closeDb } = await import("../db/index.js")
	const { recordLocalFile, pruneLocalRoms } =
		await import("../db/queries/local-roms.js")

	const db = getDb(options.dbPath)
	let recorded = 0

	const keepPaths = new Set<string>()
	for (const sys of options.manifest.systems) {
		for (const rom of sys.roms) {
			keepPaths.add(rom.path)
			recordLocalFile(db, {
				localPath: rom.path,
				fileSize: rom.size,
				system: inferCatalogSystemKey(sys.system, rom.filename),
				filename: inferCatalogFilename(rom.filename),
				...(rom.sha1 ? { sha1: rom.sha1 } : {}),
				...(rom.crc32 ? { crc32: rom.crc32 } : {}),
			})
			recorded += 1
		}
	}

	const { pruned } = pruneLocalRoms(db, {
		prefix: options.romsDir,
		keepPaths,
	})

	try {
		closeDb()
	} catch {
		// best-effort
	}

	if (!options.quiet && options.verbose) {
		ui.info(
			`Local: reconciled ${recorded.toLocaleString()} files, pruned ${pruned.toLocaleString()}`,
		)
	}

	return {
		recorded,
		pruned,
		durationMs: Math.round(nowMs() - start),
	}
}

export async function runSyncDb(options: SyncDbOptions): Promise<SyncDbResult> {
	const start = nowMs()
	const quiet = Boolean(options.quiet)
	const verbose = Boolean(options.verbose)

	const romsDir = join(options.targetDir, "Roms")
	const hasRomsDir = existsSync(romsDir)

	if (!quiet) {
		ui.header("Syncing Database")
		ui.info(`DB: ${options.dbPath}`)
		if (options.systems && options.systems.length > 0) {
			ui.info(`Systems: ${options.systems.join(", ")}`)
		}
		ui.info("Mode: parallel (remote sync + local scan)")
	}

	const scanPromise = hasRomsDir
		? runLocalScan({
				romsDir,
				...(options.systems && options.systems.length > 0
					? { systems: options.systems }
					: {}),
				quiet,
				verbose,
			})
		: Promise.resolve({
				manifest: {
					version: 1,
					generatedAt: new Date().toISOString(),
					systems: [],
					stats: {
						totalRoms: 0,
						totalSize: 0,
						systemCount: 0,
						biosCount: 0,
					},
				},
				romsFound: 0,
				systemsFound: 0,
				durationMs: 0,
			})

	const remotePromise = runRemoteSync({
		dbPath: options.dbPath,
		...(options.systems && options.systems.length > 0
			? { systems: options.systems }
			: {}),
		...(typeof options.force === "boolean" ? { force: options.force } : {}),
		quiet,
		verbose,
	})

	const [scan, remote] = await Promise.all([scanPromise, remotePromise])

	if (!quiet) {
		ui.success(
			`Scan: ${scan.romsFound.toLocaleString()} ROMs (${(
				scan.durationMs / 1000
			).toFixed(1)}s)`,
		)
		ui.success(
			`Remote: ${remote.totalRomsIndexed.toLocaleString()} ROMs indexed (${(
				remote.durationMs / 1000
			).toFixed(1)}s)`,
		)
	}

	let local: SyncDbResult["local"] = {
		recorded: 0,
		pruned: 0,
		durationMs: 0,
	}

	// Reconcile local ROM presence after remote sync finishes to avoid SQLite write contention.
	try {
		if (hasRomsDir) {
			local = await reconcileLocalRomsToDb({
				manifest: scan.manifest,
				romsDir,
				dbPath: options.dbPath,
				quiet,
				verbose,
			})
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		if (!quiet) {
			ui.error(`Local: failed to reconcile local ROMs: ${message}`)
		}
		return {
			ok: false,
			scan: {
				romsFound: scan.romsFound,
				systemsFound: scan.systemsFound,
				durationMs: scan.durationMs,
			},
			remote,
			local,
			elapsedMs: Math.round(nowMs() - start),
		}
	}

	const ok = remote.errors === 0
	const elapsedMs = Math.round(nowMs() - start)

	if (!quiet) {
		ui.success(`Done in ${(elapsedMs / 1000).toFixed(1)}s`)
	}

	return {
		ok,
		scan: {
			romsFound: scan.romsFound,
			systemsFound: scan.systemsFound,
			durationMs: scan.durationMs,
		},
		remote,
		local,
		elapsedMs,
	}
}
