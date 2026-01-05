/**
 * Database Connection Manager
 *
 * Provides a singleton database connection with proper lifecycle management.
 * Uses WAL mode for better concurrent read/write performance.
 */

import Database from "better-sqlite3"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "./schema.js"
import { log } from "../logger.js"

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type DbClient = BetterSQLite3Database<typeof schema>

interface DbInstance {
	db: DbClient
	sqlite: Database.Database
	path: string
	migrated: boolean
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, "../../drizzle")

function hasMigrationFiles(): boolean {
	if (!existsSync(MIGRATIONS_DIR)) return false
	try {
		return readdirSync(MIGRATIONS_DIR).some(f => f.endsWith(".sql"))
	} catch {
		return false
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton State
// ═══════════════════════════════════════════════════════════════════════════════

let instance: DbInstance | null = null

// ═══════════════════════════════════════════════════════════════════════════════
// Connection Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get or create a database connection.
 *
 * The connection is cached for the lifetime of the process.
 * If called with a different path than the current connection, the old
 * connection is closed and a new one is opened.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns Drizzle database client
 */
export function getDb(dbPath: string): DbClient {
	// Return existing connection if path matches
	if (instance && instance.path === dbPath) {
		return instance.db
	}

	// Close existing connection if path differs
	if (instance) {
		closeDb()
	}

	// Create new connection with optimized settings
	const sqlite = new Database(dbPath)

	// Enable WAL mode for better concurrency
	sqlite.pragma("journal_mode = WAL")

	// Performance optimizations
	sqlite.pragma("synchronous = NORMAL")
	sqlite.pragma("cache_size = -64000") // 64MB cache
	sqlite.pragma("temp_store = MEMORY")
	sqlite.pragma("mmap_size = 268435456") // 256MB mmap

	// Foreign key enforcement
	sqlite.pragma("foreign_keys = ON")

	const db = drizzle(sqlite, { schema })

	// Best-effort: keep schema up to date so queries don't break.
	try {
		if (hasMigrationFiles()) {
			migrate(db, { migrationsFolder: MIGRATIONS_DIR })
			log.db.debug(
				{ dbPath, migrationsDir: MIGRATIONS_DIR },
				"migrations checked",
			)
		} else {
			log.db.debug(
				{ dbPath, migrationsDir: MIGRATIONS_DIR },
				"no migration files found; skipping migrate",
			)
		}
	} catch (err) {
		// Surface this: a partially-migrated DB can cause confusing runtime SQL errors.
		const message = err instanceof Error ? err.message : String(err)
		throw new Error(`Failed to run database migrations: ${message}`)
	}

	instance = { db, sqlite, path: dbPath, migrated: true }

	return db
}

/**
 * Close the database connection.
 *
 * Safe to call multiple times or when no connection exists.
 */
export function closeDb(): void {
	if (!instance) return

	try {
		// Checkpoint WAL before closing
		instance.sqlite.pragma("wal_checkpoint(TRUNCATE)")
		instance.sqlite.close()
	} catch {
		// Ignore errors during close
	}

	instance = null
}

/**
 * Get the raw better-sqlite3 database instance.
 *
 * Useful for running raw SQL or using features not exposed by Drizzle.
 *
 * @throws Error if no connection is open
 */
export function getSqlite(): Database.Database {
	if (!instance) {
		throw new Error("Database not connected. Call getDb() first.")
	}
	return instance.sqlite
}

/**
 * Check if a database connection is currently open.
 */
export function isConnected(): boolean {
	return instance !== null
}

/**
 * Get the path to the currently connected database.
 *
 * @returns Database path or null if not connected
 */
export function getDbPath(): string | null {
	return instance?.path ?? null
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default database filename used by RetroSD.
 */
export const DEFAULT_DB_FILENAME = ".retrosd.db"

/**
 * Resolve the database path for a target directory.
 *
 * @param targetDir - Target directory for the collection
 * @returns Full path to the database file
 */
export function resolveDbPath(targetDir: string): string {
	return `${targetDir}/${DEFAULT_DB_FILENAME}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// Re-exports
// ═══════════════════════════════════════════════════════════════════════════════

export * from "./schema.js"
