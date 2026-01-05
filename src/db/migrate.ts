/**
 * Database Migration Runner
 *
 * Applies pending migrations to bring the database to the current schema version.
 * Uses Drizzle Kit's migration system with automatic table creation for fresh databases.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { getDb, closeDb } from "./index.js"
import { logger } from "../logger.js"

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, "../../drizzle")

// ═══════════════════════════════════════════════════════════════════════════════
// Migration Functions
// ═══════════════════════════════════════════════════════════════════════════════

export interface MigrationResult {
	applied: number
	skipped: number
	error: Error | null
}

/**
 * Run all pending migrations on the database.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns Migration result with counts and any error
 */
export async function runMigrations(dbPath: string): Promise<MigrationResult> {
	const startTime = performance.now()
	const log = logger.child({ component: "migrate" })

	try {
		// Ensure parent directory exists
		const dbDir = dirname(dbPath)
		if (!existsSync(dbDir)) {
			mkdirSync(dbDir, { recursive: true })
		}

		// Get migration files count before
		const migrationsBefore = countMigrationFiles()

		if (migrationsBefore === 0) {
			log.warn("No migration files found in drizzle directory")
			return { applied: 0, skipped: 0, error: null }
		}

		// Connect and run migrations
		const db = getDb(dbPath)

		log.info({ dbPath, migrationsDir: MIGRATIONS_DIR }, "Running migrations")

		migrate(db, { migrationsFolder: MIGRATIONS_DIR })

		const elapsed = Math.round(performance.now() - startTime)
		log.info({ elapsed, migrations: migrationsBefore }, "Migrations complete")

		return { applied: migrationsBefore, skipped: 0, error: null }
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		log.error({ err }, "Migration failed")
		return { applied: 0, skipped: 0, error: err }
	}
}

/**
 * Initialize a fresh database with the current schema.
 *
 * This is a convenience wrapper that runs migrations on a new database.
 *
 * @param dbPath - Path to the SQLite database file
 */
export async function initializeDb(dbPath: string): Promise<MigrationResult> {
	const log = logger.child({ component: "migrate" })

	if (existsSync(dbPath)) {
		log.info({ dbPath }, "Database exists, running migrations")
	} else {
		log.info({ dbPath }, "Creating new database")
	}

	return runMigrations(dbPath)
}

/**
 * Count migration files in the migrations directory.
 */
function countMigrationFiles(): number {
	if (!existsSync(MIGRATIONS_DIR)) {
		return 0
	}

	try {
		const files = readdirSync(MIGRATIONS_DIR)
		return files.filter(f => f.endsWith(".sql")).length
	} catch {
		return 0
	}
}

/**
 * CLI entry point for running migrations.
 */
export async function main(): Promise<void> {
	const dbPath = process.argv[2] || ".retrosd.db"

	console.log(`Running migrations on: ${dbPath}`)

	const result = await runMigrations(dbPath)

	if (result.error) {
		console.error("Migration failed:", result.error.message)
		process.exit(1)
	}

	console.log(`Migrations complete: ${result.applied} applied`)
	closeDb()
}
