/**
 * Test utilities for RetroSD
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initializeDb } from "../../src/db/migrate.js"
import { closeDb, getDb, type DbClient } from "../../src/db/index.js"

/**
 * Create a temporary directory for test isolation.
 * Returns cleanup function.
 */
export async function withTempDir<T>(
	fn: (dir: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "retrosd-test-"))
	try {
		return await fn(dir)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

/**
 * Create a temporary SQLite database for testing.
 * Handles initialization and cleanup.
 */
export async function withTempDb<T>(
	fn: (db: DbClient, dbPath: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "retrosd-db-"))
	const dbPath = join(dir, ".retrosd.db")
	try {
		const result = await initializeDb(dbPath)
		if (result.error) throw result.error
		const db = getDb(dbPath)
		return await fn(db, dbPath)
	} finally {
		closeDb()
		await rm(dir, { recursive: true, force: true })
	}
}

/**
 * HTTP HEAD request to check if a URL is reachable.
 * Returns status code or null if unreachable.
 */
export async function checkUrlReachable(
	url: string,
	timeoutMs = 10000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(url, {
			method: "HEAD",
			signal: controller.signal,
			redirect: "follow",
		})
		return { ok: response.ok, status: response.status }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { ok: false, error: message }
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Rate-limited batch URL checker.
 * Checks URLs in sequence with delay between requests.
 */
export async function checkUrlsBatch(
	urls: string[],
	options: { delayMs?: number; timeoutMs?: number } = {},
): Promise<Map<string, { ok: boolean; status?: number; error?: string }>> {
	const { delayMs = 500, timeoutMs = 10000 } = options
	const results = new Map<
		string,
		{ ok: boolean; status?: number; error?: string }
	>()

	for (const url of urls) {
		const result = await checkUrlReachable(url, timeoutMs)
		results.set(url, result)
		if (urls.indexOf(url) < urls.length - 1) {
			await sleep(delayMs)
		}
	}

	return results
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
