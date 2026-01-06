import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
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

describe("scan --hashes", () => {
	it("reuses stored hashes when fingerprint matches", async () => {
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
		expect(manifest.systems.length).toBe(1)
		expect(manifest.systems[0]!.system).toBe("GB")
		expect(manifest.systems[0]!.roms.length).toBe(1)
		expect(manifest.systems[0]!.roms[0]!.sha1).toBe("not-a-real-sha1")
		expect(manifest.systems[0]!.roms[0]!.crc32).toBe("deadbeef")
	})

	it("rehashes and updates metadata when fingerprint differs", async () => {
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

		expect(rom.sha1).not.toBe("not-a-real-sha1")
		expect(rom.crc32).not.toBe("deadbeef")

		const jsonPath = join(gbDir, romFilename.replace(/\.[^.]+$/, "") + ".json")
		const updated = JSON.parse(readFileSync(jsonPath, "utf8")) as {
			hash?: { sha1: string; crc32: string; size: number }
			fileSize?: number
			fileMtimeMs?: number
		}

		expect(updated.hash?.sha1).toBe(rom.sha1)
		expect(updated.hash?.crc32).toBe(rom.crc32)
		expect(updated.fileSize).toBe(updated.hash?.size)
		expect(typeof updated.fileMtimeMs).toBe("number")
		expect(updated.fileMtimeMs).toBeGreaterThan(0)
	})
})
