import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { scanCollection } from "../src/collection.js"

function writeMetadataJson(
	systemDir: string,
	romFilename: string,
	metadata: Record<string, unknown>,
): void {
	const jsonPath = join(
		systemDir,
		romFilename.replace(/\.[^.]+$/, "") + ".json",
	)
	writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), "utf8")
}

void test("scan --hashes reuses stored hashes when fingerprint matches", async () => {
	const root = mkdtempSync(join(tmpdir(), "retrosd-scan-"))
	const gbDir = join(root, "GB")
	mkdirSync(gbDir, { recursive: true })

	const romFilename = "Example (USA).gb"
	const romPath = join(gbDir, romFilename)
	writeFileSync(romPath, "hello", "utf8")

	const stat = statSync(romPath)

	writeMetadataJson(gbDir, romFilename, {
		title: "Example",
		filename: "Example (USA)",
		fullFilename: romFilename,
		system: "GB",
		region: ["USA"],
		tags: [],
		source: "no-intro",
		hash: { sha1: "not-a-real-sha1", crc32: "deadbeef", size: stat.size },
		fileSize: stat.size,
		fileMtimeMs: stat.mtimeMs,
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString(),
	})

	const manifest = await scanCollection(root, {
		includeHashes: true,
		quiet: true,
	})
	assert.equal(manifest.systems.length, 1)
	assert.equal(manifest.systems[0]!.system, "GB")
	assert.equal(manifest.systems[0]!.roms.length, 1)
	assert.equal(manifest.systems[0]!.roms[0]!.sha1, "not-a-real-sha1")
	assert.equal(manifest.systems[0]!.roms[0]!.crc32, "deadbeef")
})

void test("scan --hashes rehashes and updates metadata when fingerprint differs", async () => {
	const root = mkdtempSync(join(tmpdir(), "retrosd-scan-"))
	const gbDir = join(root, "GB")
	mkdirSync(gbDir, { recursive: true })

	const romFilename = "Example (USA).gb"
	const romPath = join(gbDir, romFilename)
	writeFileSync(romPath, "hello", "utf8")

	// Intentionally wrong fingerprint so scan must re-hash and update metadata.
	writeMetadataJson(gbDir, romFilename, {
		title: "Example",
		filename: "Example (USA)",
		fullFilename: romFilename,
		system: "GB",
		region: ["USA"],
		tags: [],
		source: "no-intro",
		hash: { sha1: "not-a-real-sha1", crc32: "deadbeef", size: 0 },
		fileSize: 0,
		fileMtimeMs: 0,
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString(),
	})

	const manifest = await scanCollection(root, {
		includeHashes: true,
		quiet: true,
	})
	const rom = manifest.systems[0]!.roms[0]!

	assert.notEqual(rom.sha1, "not-a-real-sha1")
	assert.notEqual(rom.crc32, "deadbeef")

	const jsonPath = join(gbDir, romFilename.replace(/\.[^.]+$/, "") + ".json")
	const updated = JSON.parse(readFileSync(jsonPath, "utf8")) as {
		hash?: { sha1: string; crc32: string; size: number }
		fileSize?: number
		fileMtimeMs?: number
	}

	assert.equal(updated.hash?.sha1, rom.sha1)
	assert.equal(updated.hash?.crc32, rom.crc32)
	assert.equal(updated.fileSize, updated.hash?.size)
	assert.ok(typeof updated.fileMtimeMs === "number")
	assert.ok(updated.fileMtimeMs > 0)
})
