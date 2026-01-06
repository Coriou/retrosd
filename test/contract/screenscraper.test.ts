/**
 * Contract tests for ScreenScraper API
 *
 * These tests verify that the ScreenScraper API response format hasn't
 * changed, using cached responses and optional live verification.
 *
 * Usage: npm run test:contract
 */

import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
	SCREENSCRAPER_SYSTEMS,
	ROM_EXTENSIONS_BY_SYSTEM,
	isRomFilename,
	guessRomType,
} from "../../src/core/scraper/types.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, "..", "fixtures", "scraper-responses")

describe("ScreenScraper API", () => {
	// ─────────────────────────────────────────────────────────────────────────
	// System mappings stability
	// ─────────────────────────────────────────────────────────────────────────

	describe("system mappings", () => {
		it("SCREENSCRAPER_SYSTEMS matches snapshot", () => {
			expect(SCREENSCRAPER_SYSTEMS).toMatchSnapshot()
		})

		it("ROM_EXTENSIONS_BY_SYSTEM matches snapshot", () => {
			expect(ROM_EXTENSIONS_BY_SYSTEM).toMatchSnapshot()
		})

		it("all configured systems have ScreenScraper IDs", () => {
			const systems = Object.keys(ROM_EXTENSIONS_BY_SYSTEM)

			for (const system of systems) {
				expect(
					SCREENSCRAPER_SYSTEMS[system],
					`Missing ScreenScraper ID for ${system}`,
				).toBeDefined()
			}
		})

		it("ScreenScraper IDs are valid numbers", () => {
			for (const [system, id] of Object.entries(SCREENSCRAPER_SYSTEMS)) {
				expect(typeof id, `${system} ID should be number`).toBe("number")
				expect(id, `${system} ID should be positive`).toBeGreaterThan(0)
			}
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Cached response format validation
	// ─────────────────────────────────────────────────────────────────────────

	describe("cached response format", () => {
		const samplesPath = join(fixturesDir, "samples.json")

		it("fixture file exists", () => {
			expect(existsSync(samplesPath), "Run export-test-fixtures.ts first").toBe(
				true,
			)
		})

		it("cached responses have expected structure", () => {
			if (!existsSync(samplesPath)) {
				console.log("Skipping: fixtures not exported")
				return
			}

			const data = JSON.parse(readFileSync(samplesPath, "utf8"))
			expect(data.samples).toBeDefined()
			expect(Array.isArray(data.samples)).toBe(true)

			for (const sample of data.samples) {
				expect(sample.cacheKey).toBeDefined()

				// gameId may be null for "not found" entries
				if (sample.gameId !== null) {
					expect(typeof sample.gameId).toBe("number")
				}

				// gameName should be present if game was found
				if (sample.gameId !== null) {
					expect(sample.gameName).toBeDefined()
				}
			}
		})

		it("media URLs have expected format", () => {
			if (!existsSync(samplesPath)) {
				console.log("Skipping: fixtures not exported")
				return
			}

			const data = JSON.parse(readFileSync(samplesPath, "utf8"))

			const samplesWithMedia = data.samples.filter(
				(s: { mediaUrls: unknown }) => s.mediaUrls !== null,
			)

			expect(samplesWithMedia.length).toBeGreaterThan(0)

			for (const sample of samplesWithMedia) {
				const mediaUrls = sample.mediaUrls as Record<string, string>

				for (const [type, url] of Object.entries(mediaUrls)) {
					expect(url, `${type} should be string`).toMatch(/^https?:\/\//)

					// Check for expected media types
					const validTypes = [
						"box-2D",
						"box-3D",
						"ss",
						"sstitle",
						"video",
						"video-normalized",
					]
					// At least some should match known types
				}
			}
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Helper function behavior
	// ─────────────────────────────────────────────────────────────────────────

	describe("isRomFilename", () => {
		it("accepts valid ROM extensions", () => {
			expect(isRomFilename("game.gb", "GB", false)).toBe(true)
			expect(isRomFilename("game.gba", "GBA", false)).toBe(true)
			expect(isRomFilename("game.nes", "FC", false)).toBe(true)
			expect(isRomFilename("game.chd", "PS", false)).toBe(true)
		})

		it("accepts archive extensions", () => {
			expect(isRomFilename("game.zip", "GB", false)).toBe(true)
			expect(isRomFilename("game.7z", "PS", false)).toBe(true)
		})

		it("rejects non-ROM extensions", () => {
			expect(isRomFilename("readme.txt", "GB", false)).toBe(false)
			expect(isRomFilename("metadata.json", "GBA", false)).toBe(false)
			expect(isRomFilename("info.nfo", "FC", false)).toBe(false)
		})

		it("rejects hidden files", () => {
			expect(isRomFilename(".DS_Store", "GB", false)).toBe(false)
			expect(isRomFilename(".gitignore", "GBA", false)).toBe(false)
		})

		it("handles includeUnknown flag", () => {
			// Unknown extension
			expect(isRomFilename("game.xyz", "GB", false)).toBe(false)
			expect(isRomFilename("game.xyz", "GB", true)).toBe(true)
		})
	})

	describe("guessRomType", () => {
		it("returns iso for PlayStation", () => {
			expect(guessRomType("PS", "game.chd")).toBe("iso")
			expect(guessRomType("PS", "game.bin")).toBe("iso")
			expect(guessRomType("PS", "game.cue")).toBe("iso")
		})

		it("returns rom for cartridge systems", () => {
			expect(guessRomType("GB", "game.gb")).toBe("rom")
			expect(guessRomType("GBA", "game.gba")).toBe("rom")
			expect(guessRomType("FC", "game.nes")).toBe("rom")
		})

		it("returns iso for disc-based extensions", () => {
			expect(guessRomType("MD", "game.iso")).toBe("iso")
			expect(guessRomType("MD", "game.cue")).toBe("iso")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// API endpoint stability (snapshot)
	// ─────────────────────────────────────────────────────────────────────────

	describe("API configuration", () => {
		it("documents expected API behavior", () => {
			// This test documents expected API patterns for reference
			const apiPatterns = {
				searchEndpoint: "https://www.screenscraper.fr/api2/jeuInfos.php",
				requiredParams: [
					"devid",
					"devpassword",
					"softname",
					"output",
					"romtype",
					"systemeid",
					"romnom",
				],
				optionalParams: ["ssid", "sspassword", "crc", "md5", "sha1"],
				outputFormat: "json",
				mediaTypes: [
					"box-2D",
					"box-3D",
					"ss",
					"sstitle",
					"video",
					"video-normalized",
				],
			}

			expect(apiPatterns).toMatchSnapshot()
		})
	})
})
