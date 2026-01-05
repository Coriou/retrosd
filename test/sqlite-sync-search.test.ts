import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { initializeDb } from "../src/db/migrate.js"
import { closeDb, getDb } from "../src/db/index.js"
import { remoteRoms, romMetadata, localRoms } from "../src/db/schema.js"
import { recordDownload, pruneLocalRoms } from "../src/db/queries/local-roms.js"
import { searchRoms, countSearchResults } from "../src/db/queries/search.js"

async function withTempDb<T>(fn: (dbPath: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "retrosd-test-"))
	const dbPath = join(dir, ".retrosd.db")
	try {
		const result = await initializeDb(dbPath)
		if (result.error) throw result.error
		return await fn(dbPath)
	} finally {
		closeDb()
		await rm(dir, { recursive: true, force: true })
	}
}

await test("search marks ROM as local via system/filename even without remoteRomId", async () => {
	await withTempDb(async dbPath => {
		const db = getDb(dbPath)

		// Simulate a download that happened before a catalog sync.
		recordDownload(db, {
			localPath: "/tmp/Roms/GB/Pokemon - Red Version (USA, Europe).gb",
			fileSize: 123,
			system: "GB",
			filename: "Pokemon - Red Version (USA, Europe).gb",
		})

		// Later, sync inserts the remote catalog row.
		const remote = db
			.insert(remoteRoms)
			.values({
				system: "GB",
				source: "no-intro",
				filename: "Pokemon - Red Version (USA, Europe).gb",
				size: 123,
			})
			.returning({ id: remoteRoms.id })
			.get()

		db.insert(romMetadata)
			.values({
				remoteRomId: remote.id,
				title: "Pokemon - Red Version",
				regions: ["USA", "Europe"],
				languages: ["En"],
			})
			.run()

		const results = searchRoms(db, {
			query: "Pokemon",
			excludePrerelease: true,
		})
		assert.equal(results.length, 1)
		assert.equal(results[0]?.isLocal, true)
		assert.equal(
			results[0]?.localPath,
			"/tmp/Roms/GB/Pokemon - Red Version (USA, Europe).gb",
		)
	})
})

await test("localOnly filter works with system/filename matching", async () => {
	await withTempDb(async dbPath => {
		const db = getDb(dbPath)

		const remote = db
			.insert(remoteRoms)
			.values({
				system: "GB",
				source: "no-intro",
				filename: "Tetris (World).gb",
				size: 456,
			})
			.returning({ id: remoteRoms.id })
			.get()

		db.insert(romMetadata)
			.values({
				remoteRomId: remote.id,
				title: "Tetris",
				regions: ["World"],
			})
			.run()

		// Download before linking (remoteRomId will be found by system+filename anyway)
		recordDownload(db, {
			localPath: "/tmp/Roms/GB/Tetris (World).gb",
			fileSize: 456,
			system: "GB",
			filename: "Tetris (World).gb",
		})

		assert.equal(
			countSearchResults(db, {
				query: "Tetris",
				localOnly: true,
				excludePrerelease: true,
			}),
			1,
		)

		const results = searchRoms(db, {
			query: "Tetris",
			localOnly: true,
			excludePrerelease: true,
		})
		assert.equal(results.length, 1)
		assert.equal(results[0]?.isLocal, true)
	})
})

await test("pruneLocalRoms removes stale local paths under prefix", async () => {
	await withTempDb(async dbPath => {
		const db = getDb(dbPath)

		// Seed a remote catalog row so local tracking has something to match.
		const remote = db
			.insert(remoteRoms)
			.values({
				system: "GB",
				source: "no-intro",
				filename: "Tetris (World).gb",
				size: 456,
			})
			.returning({ id: remoteRoms.id })
			.get()

		db.insert(romMetadata)
			.values({
				remoteRomId: remote.id,
				title: "Tetris",
				regions: ["World"],
			})
			.run()

		// Simulate stale DB entry (e.g., deleted archive) + a real kept file.
		recordDownload(db, {
			localPath: "/tmp/Roms/GB/Tetris (World).zip",
			fileSize: 999,
			system: "GB",
			filename: "Tetris (World).gb",
		})
		recordDownload(db, {
			localPath: "/tmp/Roms/GB/Tetris (World).gb",
			fileSize: 456,
			system: "GB",
			filename: "Tetris (World).gb",
		})

		const before = db.select().from(localRoms).all().length
		const pruned = pruneLocalRoms(db, {
			prefix: "/tmp/Roms",
			keepPaths: new Set(["/tmp/Roms/GB/Tetris (World).gb"]),
		})
		const after = db.select().from(localRoms).all().length

		assert.ok(before >= 2)
		assert.equal(pruned.pruned, 1)
		assert.equal(after, before - 1)
	})
})
