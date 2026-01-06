/**
 * Unit tests for archive extraction
 *
 * Tests ZIP extraction functionality including glob filtering,
 * atomic writes, and archive deletion.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import {
	mkdtempSync,
	writeFileSync,
	existsSync,
	readFileSync,
	rmSync,
	mkdirSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { extractZip, isZipArchive, is7zArchive } from "../../src/extract.js"

describe("extractZip", () => {
	let tempDir: string
	let zipPath: string
	let contentDir: string

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "retrosd-extract-"))
		contentDir = join(tempDir, "content")
		zipPath = join(tempDir, "test.zip")

		// Create test content
		mkdirSync(contentDir, { recursive: true })
		writeFileSync(join(contentDir, "game.nes"), "NES ROM content here")
		writeFileSync(join(contentDir, "game.gb"), "Game Boy ROM content")
		writeFileSync(join(contentDir, "readme.txt"), "Documentation")
		mkdirSync(join(contentDir, "subdir"), { recursive: true })
		writeFileSync(
			join(contentDir, "subdir", "nested.nes"),
			"Nested ROM content",
		)

		// Create ZIP archive
		execSync(`cd "${contentDir}" && zip -r "${zipPath}" .`, {
			stdio: "ignore",
		})
	})

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Basic extraction
	// ─────────────────────────────────────────────────────────────────────────

	describe("basic extraction", () => {
		it("extracts all files with * glob", async () => {
			const destDir = join(tempDir, "out-all")

			const result = await extractZip(zipPath, destDir, {
				extractGlob: "*",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(true)
			expect(result.extractedFiles).toContain("game.nes")
			expect(result.extractedFiles).toContain("game.gb")
			expect(result.extractedFiles).toContain("readme.txt")
		})

		it("creates destination directory", async () => {
			const destDir = join(tempDir, "new-dir-" + Date.now())

			expect(existsSync(destDir)).toBe(false)

			const result = await extractZip(zipPath, destDir, {
				extractGlob: "*",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(true)
			expect(existsSync(destDir)).toBe(true)
		})

		it("extracts correct file content", async () => {
			const destDir = join(tempDir, "out-content")

			await extractZip(zipPath, destDir, {
				extractGlob: "*.nes",
				deleteArchive: false,
				flatten: true,
			})

			const content = readFileSync(join(destDir, "game.nes"), "utf8")
			expect(content).toBe("NES ROM content here")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Glob filtering
	// ─────────────────────────────────────────────────────────────────────────

	describe("glob filtering", () => {
		it("filters by extension with *.ext", async () => {
			const destDir = join(tempDir, "out-nes")

			const result = await extractZip(zipPath, destDir, {
				extractGlob: "*.nes",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(true)
			expect(result.extractedFiles).toContain("game.nes")
			expect(result.extractedFiles).not.toContain("game.gb")
			expect(result.extractedFiles).not.toContain("readme.txt")
		})

		it("filters by different extension", async () => {
			const destDir = join(tempDir, "out-gb")

			const result = await extractZip(zipPath, destDir, {
				extractGlob: "*.gb",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(true)
			expect(result.extractedFiles).toContain("game.gb")
			expect(result.extractedFiles).not.toContain("game.nes")
		})

		it("handles case-insensitive matching", async () => {
			const destDir = join(tempDir, "out-case")

			const result = await extractZip(zipPath, destDir, {
				extractGlob: "*.NES",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(true)
			expect(result.extractedFiles).toContain("game.nes")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Flatten option
	// ─────────────────────────────────────────────────────────────────────────

	describe("flatten option", () => {
		it("extracts nested files to root when flatten=true", async () => {
			const destDir = join(tempDir, "out-flatten")

			const result = await extractZip(zipPath, destDir, {
				extractGlob: "*.nes",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(true)
			// Both game.nes and subdir/nested.nes should be at root
			expect(existsSync(join(destDir, "game.nes"))).toBe(true)
			expect(existsSync(join(destDir, "nested.nes"))).toBe(true)
		})

		it("preserves directory structure when flatten=false", async () => {
			const destDir = join(tempDir, "out-no-flatten")

			const result = await extractZip(zipPath, destDir, {
				extractGlob: "*.nes",
				deleteArchive: false,
				flatten: false,
			})

			expect(result.success).toBe(true)
			expect(existsSync(join(destDir, "game.nes"))).toBe(true)
			expect(existsSync(join(destDir, "subdir", "nested.nes"))).toBe(true)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Archive deletion
	// ─────────────────────────────────────────────────────────────────────────

	describe("archive deletion", () => {
		it("preserves archive when deleteArchive=false", async () => {
			const destDir = join(tempDir, "out-preserve")

			await extractZip(zipPath, destDir, {
				extractGlob: "*",
				deleteArchive: false,
				flatten: true,
			})

			expect(existsSync(zipPath)).toBe(true)
		})

		it("deletes archive when deleteArchive=true", async () => {
			// Create a copy to delete
			const copyPath = join(tempDir, `delete-me-${Date.now()}.zip`)
			execSync(`cp "${zipPath}" "${copyPath}"`)

			const destDir = join(tempDir, "out-delete")

			await extractZip(copyPath, destDir, {
				extractGlob: "*",
				deleteArchive: true,
				flatten: true,
			})

			expect(existsSync(copyPath)).toBe(false)
		})

		it("only deletes archive on successful extraction", async () => {
			// Create a copy
			const copyPath = join(tempDir, `no-delete-${Date.now()}.zip`)
			execSync(`cp "${zipPath}" "${copyPath}"`)

			const destDir = join(tempDir, "out-no-match")

			// Glob that matches nothing
			const result = await extractZip(copyPath, destDir, {
				extractGlob: "*.nonexistent",
				deleteArchive: true,
				flatten: true,
			})

			// No files extracted, so archive should remain
			expect(result.extractedFiles).toHaveLength(0)
			expect(existsSync(copyPath)).toBe(true)

			// Clean up
			rmSync(copyPath)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Error handling
	// ─────────────────────────────────────────────────────────────────────────

	describe("error handling", () => {
		it("fails gracefully for missing archive", async () => {
			const destDir = join(tempDir, "out-missing")

			const result = await extractZip("/nonexistent/archive.zip", destDir, {
				extractGlob: "*",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})

		it("fails gracefully for corrupt archive", async () => {
			const corruptPath = join(tempDir, "corrupt.zip")
			writeFileSync(corruptPath, "not a valid zip file")

			const destDir = join(tempDir, "out-corrupt")

			const result = await extractZip(corruptPath, destDir, {
				extractGlob: "*",
				deleteArchive: false,
				flatten: true,
			})

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})
	})
})

describe("isZipArchive", () => {
	it("returns true for .zip files", () => {
		expect(isZipArchive("game.zip")).toBe(true)
		expect(isZipArchive("GAME.ZIP")).toBe(true)
		expect(isZipArchive("path/to/game.zip")).toBe(true)
	})

	it("returns false for other extensions", () => {
		expect(isZipArchive("game.7z")).toBe(false)
		expect(isZipArchive("game.rar")).toBe(false)
		expect(isZipArchive("game.nes")).toBe(false)
		expect(isZipArchive("game.gb")).toBe(false)
	})

	it("returns false for files without extension", () => {
		expect(isZipArchive("game")).toBe(false)
	})
})

describe("is7zArchive", () => {
	it("returns true for .7z files", () => {
		expect(is7zArchive("game.7z")).toBe(true)
		expect(is7zArchive("GAME.7Z")).toBe(true)
		expect(is7zArchive("path/to/game.7z")).toBe(true)
	})

	it("returns false for other extensions", () => {
		expect(is7zArchive("game.zip")).toBe(false)
		expect(is7zArchive("game.rar")).toBe(false)
	})
})
