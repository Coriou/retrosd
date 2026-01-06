import { describe, it, expect } from "vitest"
import { withTempDb } from "./helpers/index.js"
import { remoteRoms, romMetadata, localRoms } from "../src/db/schema.js"
import { recordDownload, pruneLocalRoms } from "../src/db/queries/local-roms.js"
import { searchRoms, countSearchResults } from "../src/db/queries/search.js"

describe("sqlite sync/search", () => {
	it("search marks ROM as local via system/filename even without remoteRomId", async () => {
		await withTempDb(async (db, _dbPath) => {
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
			expect(results.length).toBe(1)
			expect(results[0]?.isLocal).toBe(true)
			expect(results[0]?.localPath).toBe(
				"/tmp/Roms/GB/Pokemon - Red Version (USA, Europe).gb",
			)
		})
	})

	it("localOnly filter works with system/filename matching", async () => {
		await withTempDb(async (db, _dbPath) => {
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

			expect(
				countSearchResults(db, {
					query: "Tetris",
					localOnly: true,
					excludePrerelease: true,
				}),
			).toBe(1)

			const results = searchRoms(db, {
				query: "Tetris",
				localOnly: true,
				excludePrerelease: true,
			})
			expect(results.length).toBe(1)
			expect(results[0]?.isLocal).toBe(true)
		})
	})

	it("pruneLocalRoms removes stale local paths under prefix", async () => {
		await withTempDb(async (db, _dbPath) => {
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

			expect(before).toBeGreaterThanOrEqual(2)
			expect(pruned.pruned).toBe(1)
			expect(after).toBe(before - 1)
		})
	})
})
