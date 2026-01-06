/**
 * Unit tests for ROM filename parsing
 *
 * Tests parseRomFilenameParts() against real catalog filenames to ensure
 * correct extraction of regions, languages, versions, and special flags.
 */

import { describe, it, expect } from "vitest"
import { parseRomFilenameParts } from "../../src/romname.js"
import romFilenames from "../fixtures/rom-filenames.json" with { type: "json" }

describe("parseRomFilenameParts", () => {
	// ─────────────────────────────────────────────────────────────────────────
	// Regression tests against real catalog data
	// ─────────────────────────────────────────────────────────────────────────

	describe("real catalog filenames", () => {
		// Sample diverse filenames for snapshot testing
		const diverseSamples = romFilenames.samples.slice(0, 50)

		it.each(diverseSamples.map(s => [s.filename, s.system]))(
			"parses %s correctly",
			(filename, _system) => {
				const result = parseRomFilenameParts(filename)

				// Basic sanity checks
				expect(result.baseName).toBeDefined()
				expect(result.title).toBeDefined()
				expect(result.title.length).toBeGreaterThan(0)

				// Snapshot for regression detection
				expect(result).toMatchSnapshot()
			},
		)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Region extraction
	// ─────────────────────────────────────────────────────────────────────────

	describe("region extraction", () => {
		it("extracts single region", () => {
			const result = parseRomFilenameParts("Pokemon Red (USA).gb")
			expect(result.regions).toEqual(["USA"])
			expect(result.regionCodes).toEqual(["us"])
		})

		it("extracts multiple regions", () => {
			const result = parseRomFilenameParts("Pokemon Red (USA, Europe).gb")
			expect(result.regions).toContain("USA")
			expect(result.regions).toContain("Europe")
			expect(result.regionCodes).toContain("us")
			expect(result.regionCodes).toContain("eu")
		})

		it("handles World region", () => {
			const result = parseRomFilenameParts("Tetris (World).gb")
			expect(result.regions).toContain("World")
			expect(result.regionCodes).toContain("wor")
		})

		it("handles Japan region", () => {
			const result = parseRomFilenameParts("Game (Japan).nes")
			expect(result.regionCodes).toContain("jp")
		})

		it("handles Europe with multiple countries", () => {
			const result = parseRomFilenameParts("Game (Europe) (En,Fr,De).gba")
			expect(result.regionCodes).toContain("eu")
			expect(result.languages).toContain("en")
			expect(result.languages).toContain("fr")
			expect(result.languages).toContain("de")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Language extraction
	// ─────────────────────────────────────────────────────────────────────────

	describe("language extraction", () => {
		it("extracts single language", () => {
			const result = parseRomFilenameParts("Game (Europe) (En).gba")
			expect(result.languages).toEqual(["en"])
		})

		it("extracts multiple languages", () => {
			const result = parseRomFilenameParts("Game (Europe) (En,Fr,De,Es).gba")
			expect(result.languages).toContain("en")
			expect(result.languages).toContain("fr")
			expect(result.languages).toContain("de")
			expect(result.languages).toContain("es")
		})

		it("handles language in region parentheses", () => {
			const result = parseRomFilenameParts("Game (Taiwan) (En,Zh).gb")
			expect(result.languages).toContain("en")
			expect(result.languages).toContain("zh")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Version/revision extraction
	// ─────────────────────────────────────────────────────────────────────────

	describe("version extraction", () => {
		it("parses Rev 1 format", () => {
			const result = parseRomFilenameParts("Game (USA) (Rev 1).nes")
			expect(result.version).toBe("Rev 1")
			expect(result.versionInfo).toMatchObject({
				kind: "rev",
				parts: [1],
				raw: "Rev 1",
			})
		})

		it("parses Rev 2 format", () => {
			const result = parseRomFilenameParts("Game (USA) (Rev 2).nes")
			expect(result.versionInfo?.parts).toEqual([2])
		})

		it("parses Rev A format", () => {
			const result = parseRomFilenameParts("Game (USA) (Rev A).nes")
			expect(result.versionInfo?.letter).toBe("A")
		})

		it("parses v1.0 format", () => {
			const result = parseRomFilenameParts("Game (Europe) (v1.0).gba")
			expect(result.versionInfo).toMatchObject({
				kind: "ver",
				parts: [1, 0],
			})
		})

		it("parses v1.2 format", () => {
			const result = parseRomFilenameParts("Game (USA) (v1.2).gba")
			expect(result.versionInfo?.parts).toEqual([1, 2])
		})

		it("handles no version", () => {
			const result = parseRomFilenameParts("Game (USA).gb")
			expect(result.versionInfo).toBeUndefined()
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Flag detection (prerelease, unlicensed, hack, homebrew)
	// ─────────────────────────────────────────────────────────────────────────

	describe("flag detection", () => {
		describe("prerelease flags", () => {
			it("detects Beta", () => {
				const result = parseRomFilenameParts("Game (USA) (Beta).gb")
				expect(result.flags.prerelease).toBe(true)
			})

			it("detects Proto", () => {
				const result = parseRomFilenameParts("Game (Japan) (Proto).gb")
				expect(result.flags.prerelease).toBe(true)
			})

			it("detects Demo", () => {
				const result = parseRomFilenameParts("Game (USA) (Demo).gba")
				expect(result.flags.prerelease).toBe(true)
			})

			it("detects Sample", () => {
				const result = parseRomFilenameParts("Game (USA) (Sample).nes")
				expect(result.flags.prerelease).toBe(true)
			})

			it("detects Beta with version", () => {
				const result = parseRomFilenameParts("Game (USA) (Beta 1).gb")
				expect(result.flags.prerelease).toBe(true)
			})
		})

		describe("unlicensed flags", () => {
			it("detects Unl tag", () => {
				const result = parseRomFilenameParts("Game (USA) (Unl).gb")
				expect(result.flags.unlicensed).toBe(true)
			})

			it("detects Pirate tag", () => {
				const result = parseRomFilenameParts("Game (World) (Pirate).gb")
				expect(result.flags.unlicensed).toBe(true)
			})

			it("detects Bootleg tag", () => {
				const result = parseRomFilenameParts("Game (Japan) (Bootleg).nes")
				expect(result.flags.unlicensed).toBe(true)
			})
		})

		describe("hack flags", () => {
			it("detects Hack tag", () => {
				const result = parseRomFilenameParts("Game (USA) (Hack).gb")
				expect(result.flags.hack).toBe(true)
			})
		})

		describe("homebrew flags", () => {
			it("detects Homebrew tag", () => {
				const result = parseRomFilenameParts("Game (USA) (Homebrew).nes")
				expect(result.flags.homebrew).toBe(true)
			})
		})

		describe("flag combinations", () => {
			it("handles multiple flags", () => {
				// Some real-world filenames have multiple special tags
				const result = parseRomFilenameParts("Game (USA) (Beta) (Unl).gb")
				expect(result.flags.prerelease).toBe(true)
				expect(result.flags.unlicensed).toBe(true)
			})

			it("clean ROM has no flags", () => {
				const result = parseRomFilenameParts("Pokemon Red (USA).gb")
				expect(result.flags.prerelease).toBe(false)
				expect(result.flags.unlicensed).toBe(false)
				expect(result.flags.hack).toBe(false)
				expect(result.flags.homebrew).toBe(false)
			})
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Disc parsing
	// ─────────────────────────────────────────────────────────────────────────

	describe("disc parsing", () => {
		it("parses Disc 1", () => {
			const result = parseRomFilenameParts(
				"Final Fantasy VII (USA) (Disc 1).chd",
			)
			expect(result.disc).toMatchObject({
				type: "disc",
				index: 1,
			})
		})

		it("parses Disc 2 of 3", () => {
			const result = parseRomFilenameParts("Game (Europe) (Disc 2 of 3).chd")
			expect(result.disc?.index).toBe(2)
			expect(result.disc?.total).toBe(3)
		})

		it("handles no disc info", () => {
			const result = parseRomFilenameParts("Game (USA).gb")
			expect(result.disc).toBeUndefined()
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Title extraction
	// ─────────────────────────────────────────────────────────────────────────

	describe("title extraction", () => {
		it("extracts clean title", () => {
			const result = parseRomFilenameParts("Pokemon Red (USA).gb")
			expect(result.title).toBe("Pokemon Red")
		})

		it("handles title with hyphen", () => {
			const result = parseRomFilenameParts(
				"Legend of Zelda, The - Link's Awakening (USA).gb",
			)
			expect(result.title).toContain("Zelda")
		})

		it("handles title with colon", () => {
			const result = parseRomFilenameParts(
				"Castlevania - Symphony of the Night (USA).chd",
			)
			expect(result.title).toContain("Castlevania")
		})

		it("strips extension from baseName", () => {
			const result = parseRomFilenameParts("Game (USA).gb")
			expect(result.baseName).toBe("Game (USA)")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ─────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles complex filename with many tags", () => {
			const filename = "Game (Europe) (En,Fr,De,Es,It) (Rev 2) (Beta).gba"
			const result = parseRomFilenameParts(filename)

			expect(result.regionCodes).toContain("eu")
			expect(result.languages.length).toBeGreaterThanOrEqual(4)
			expect(result.versionInfo?.parts).toContain(2)
			expect(result.flags.prerelease).toBe(true)
		})

		it("handles parentheses in title", () => {
			const result = parseRomFilenameParts("GoldenEye 007 (USA).n64")
			expect(result.title).toContain("GoldenEye")
		})

		it("handles numbers in title", () => {
			const result = parseRomFilenameParts(
				"Final Fantasy VII (USA) (Disc 1).chd",
			)
			expect(result.title).toContain("Final Fantasy VII")
		})
	})
})
