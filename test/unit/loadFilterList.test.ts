/**
 * Unit tests for loadFilterList function
 *
 * Tests file-based filter list loading for include/exclude lists.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadFilterList } from "../../src/filters.js"

describe("loadFilterList", () => {
	let tempDir: string

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "retrosd-filter-"))
	})

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Basic functionality
	// ─────────────────────────────────────────────────────────────────────────

	describe("basic loading", () => {
		it("loads simple filenames", () => {
			const filePath = join(tempDir, "simple.txt")
			writeFileSync(
				filePath,
				["Game A (USA).gb", "Game B (Europe).gb", "Game C (Japan).gb"].join(
					"\n",
				),
			)

			const result = loadFilterList(filePath)

			expect(result.size).toBe(3)
			expect(result.has("game a (usa).gb")).toBe(true)
			expect(result.has("game b (europe).gb")).toBe(true)
			expect(result.has("game c (japan).gb")).toBe(true)
		})

		it("returns lowercase normalized keys", () => {
			const filePath = join(tempDir, "case.txt")
			writeFileSync(filePath, "Pokemon Red (USA).gb")

			const result = loadFilterList(filePath)

			expect(result.has("pokemon red (usa).gb")).toBe(true)
			expect(result.has("Pokemon Red (USA).gb")).toBe(false) // Not exact match
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Comment and blank line handling
	// ─────────────────────────────────────────────────────────────────────────

	describe("comments and blank lines", () => {
		it("ignores comment lines starting with #", () => {
			const filePath = join(tempDir, "comments.txt")
			writeFileSync(
				filePath,
				[
					"# This is a comment",
					"Game A (USA).gb",
					"# Another comment",
					"Game B (Europe).gb",
					"  # Indented comment",
				].join("\n"),
			)

			const result = loadFilterList(filePath)

			expect(result.size).toBe(2)
			expect(result.has("game a (usa).gb")).toBe(true)
			expect(result.has("game b (europe).gb")).toBe(true)
		})

		it("ignores empty lines", () => {
			const filePath = join(tempDir, "blanks.txt")
			writeFileSync(
				filePath,
				["Game A (USA).gb", "", "", "Game B (Europe).gb", "   ", ""].join("\n"),
			)

			const result = loadFilterList(filePath)

			expect(result.size).toBe(2)
		})

		it("handles file with only comments and blanks", () => {
			const filePath = join(tempDir, "empty-content.txt")
			writeFileSync(
				filePath,
				["# Header comment", "", "# Another comment", "   "].join("\n"),
			)

			const result = loadFilterList(filePath)

			expect(result.size).toBe(0)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Quote stripping
	// ─────────────────────────────────────────────────────────────────────────

	describe("quote handling", () => {
		it("strips double quotes from filenames", () => {
			const filePath = join(tempDir, "double-quotes.txt")
			writeFileSync(
				filePath,
				['"Game A (USA).gb"', '"Game B (Europe).gb"'].join("\n"),
			)

			const result = loadFilterList(filePath)

			expect(result.size).toBe(2)
			expect(result.has("game a (usa).gb")).toBe(true)
			expect(result.has("game b (europe).gb")).toBe(true)
		})

		it("strips single quotes from filenames", () => {
			const filePath = join(tempDir, "single-quotes.txt")
			writeFileSync(filePath, ["'Game A (USA).gb'", "'Game B.gb'"].join("\n"))

			const result = loadFilterList(filePath)

			expect(result.size).toBe(2)
			expect(result.has("game a (usa).gb")).toBe(true)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Path handling
	// ─────────────────────────────────────────────────────────────────────────

	describe("path handling", () => {
		it("extracts basename from Unix-style paths", () => {
			const filePath = join(tempDir, "paths.txt")
			writeFileSync(
				filePath,
				[
					"/path/to/roms/Game A (USA).gb",
					"./relative/Game B (Europe).gb",
					"roms/Game C.gb",
				].join("\n"),
			)

			const result = loadFilterList(filePath)

			expect(result.size).toBe(3)
			expect(result.has("game a (usa).gb")).toBe(true)
			expect(result.has("game b (europe).gb")).toBe(true)
			expect(result.has("game c.gb")).toBe(true)
		})

		it("handles quoted paths", () => {
			const filePath = join(tempDir, "quoted-paths.txt")
			writeFileSync(
				filePath,
				'"/path/to/Game A (USA).gb"\n"/another/path/Game B.gb"',
			)

			const result = loadFilterList(filePath)

			expect(result.has("game a (usa).gb")).toBe(true)
			expect(result.has("game b.gb")).toBe(true)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ─────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles Windows line endings (CRLF)", () => {
			const filePath = join(tempDir, "crlf.txt")
			writeFileSync(filePath, "Game A.gb\r\nGame B.gb\r\n")

			const result = loadFilterList(filePath)

			expect(result.size).toBe(2)
		})

		it("handles trailing whitespace", () => {
			const filePath = join(tempDir, "whitespace.txt")
			writeFileSync(filePath, "Game A.gb   \nGame B.gb\t\n")

			const result = loadFilterList(filePath)

			expect(result.has("game a.gb")).toBe(true)
			expect(result.has("game b.gb")).toBe(true)
		})

		it("throws for non-existent file", () => {
			expect(() => loadFilterList("/nonexistent/file.txt")).toThrow()
		})
	})
})
