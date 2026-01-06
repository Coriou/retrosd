/**
 * Unit tests for ROM filtering and 1G1R selection
 *
 * Tests the core filtering logic that determines which ROMs to download
 * and the 1G1R (one-game-one-ROM) selection algorithm.
 */

import { describe, it, expect } from "vitest"
import {
	apply1G1R,
	applyFilters,
	calculatePriority,
	getPresetFilter,
	getExclusionFilter,
	parsePatternList,
	loadFilterList,
	DEFAULT_REGION_PRIORITY,
	DEFAULT_LANGUAGE_PRIORITY,
} from "../../src/filters.js"

describe("apply1G1R", () => {
	// ─────────────────────────────────────────────────────────────────────────
	// Region priority selection
	// ─────────────────────────────────────────────────────────────────────────

	describe("region priority", () => {
		it("keeps highest priority region (default: EU > USA)", () => {
			const input = [
				"Pokemon Red (USA).gb",
				"Pokemon Red (Europe).gb",
				"Pokemon Red (Japan).gb",
			]
			const result = apply1G1R(input)

			expect(result).toHaveLength(1)
			expect(result[0]).toBe("Pokemon Red (Europe).gb")
		})

		it("keeps USA when no Europe version exists", () => {
			const input = ["Pokemon Red (USA).gb", "Pokemon Red (Japan).gb"]
			const result = apply1G1R(input)

			expect(result).toHaveLength(1)
			expect(result[0]).toBe("Pokemon Red (USA).gb")
		})

		it("respects custom region priority", () => {
			const input = ["Game (USA).gb", "Game (Japan).gb", "Game (Europe).gb"]
			const result = apply1G1R(input, {
				regionPriority: ["jp", "us", "eu"],
			})

			expect(result).toHaveLength(1)
			expect(result[0]).toBe("Game (Japan).gb")
		})

		it("respects preferredRegion option", () => {
			const input = ["Game (USA).gb", "Game (Japan).gb"]
			const result = apply1G1R(input, {
				preferredRegion: "jp",
			})

			expect(result).toHaveLength(1)
			expect(result[0]).toBe("Game (Japan).gb")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Version/revision selection
	// ─────────────────────────────────────────────────────────────────────────

	describe("version selection", () => {
		it("prefers higher revision", () => {
			const input = [
				"Game (USA).nes",
				"Game (USA) (Rev 1).nes",
				"Game (USA) (Rev 2).nes",
			]
			const result = apply1G1R(input)

			expect(result).toHaveLength(1)
			expect(result[0]).toBe("Game (USA) (Rev 2).nes")
		})

		it("prefers Rev 3 over Rev 2 over Rev 1", () => {
			const input = [
				"Game (Europe) (Rev 1).gba",
				"Game (Europe) (Rev 3).gba",
				"Game (Europe) (Rev 2).gba",
			]
			const result = apply1G1R(input)

			expect(result[0]).toBe("Game (Europe) (Rev 3).gba")
		})

		it("prefers higher version number", () => {
			const input = [
				"Game (USA) (v1.0).gba",
				"Game (USA) (v1.2).gba",
				"Game (USA) (v1.1).gba",
			]
			const result = apply1G1R(input)

			expect(result[0]).toBe("Game (USA) (v1.2).gba")
		})

		it("combines region and version priority", () => {
			const input = ["Game (USA) (Rev 2).nes", "Game (Europe) (Rev 1).nes"]
			const result = apply1G1R(input)

			// EU wins on region, even with lower revision
			expect(result[0]).toContain("Europe")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Multi-disc handling
	// ─────────────────────────────────────────────────────────────────────────

	describe("multi-disc handling", () => {
		it("preserves all discs of selected version", () => {
			const input = [
				"Final Fantasy VII (USA) (Disc 1).chd",
				"Final Fantasy VII (USA) (Disc 2).chd",
				"Final Fantasy VII (USA) (Disc 3).chd",
			]
			const result = apply1G1R(input)

			// Should keep all 3 discs
			expect(result).toHaveLength(3)
		})

		it("selects best region-language group and keeps all its discs", () => {
			const input = [
				"Game (Europe) (Disc 1).chd",
				"Game (Europe) (Disc 2).chd",
				"Game (USA) (Disc 1).chd",
				"Game (USA) (Disc 2).chd",
			]
			const result = apply1G1R(input)

			// Should keep Europe discs only
			expect(result).toHaveLength(2)
			expect(result.every(f => f.includes("Europe"))).toBe(true)
		})

		it("handles single disc games correctly", () => {
			const input = ["Game A (USA).chd", "Game A (Europe).chd"]
			const result = apply1G1R(input)

			expect(result).toHaveLength(1)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ─────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles single ROM input", () => {
			const input = ["Game (USA).gb"]
			const result = apply1G1R(input)

			expect(result).toEqual(input)
		})

		it("handles empty input", () => {
			const result = apply1G1R([])
			expect(result).toEqual([])
		})

		it("handles ROMs without region tags", () => {
			const input = ["Some Game.gb", "Another Game (USA).gb"]
			const result = apply1G1R(input)

			// Should include both as different titles
			expect(result.length).toBeGreaterThanOrEqual(1)
		})

		it("treats different titles independently", () => {
			const input = [
				"Pokemon Red (USA).gb",
				"Pokemon Red (Europe).gb",
				"Tetris (USA).gb",
				"Tetris (Europe).gb",
			]
			const result = apply1G1R(input)

			// Should have one of each title
			expect(result).toHaveLength(2)
			expect(result.some(f => f.includes("Pokemon"))).toBe(true)
			expect(result.some(f => f.includes("Tetris"))).toBe(true)
		})
	})
})

describe("applyFilters", () => {
	const sampleFilenames = [
		"Pokemon Red (USA).gb",
		"Pokemon Red (Europe).gb",
		"Pokemon Red (Japan).gb",
		"Tetris (World).gb",
		"Game (USA) (Beta).gb",
		"Game (USA) (Proto).gb",
		"Pirate Game (USA) (Unl).gb",
		"Hack Game (USA) (Hack).gb",
		"Homebrew Game (USA) (Homebrew).gb",
	]

	// ─────────────────────────────────────────────────────────────────────────
	// Region filtering
	// ─────────────────────────────────────────────────────────────────────────

	describe("region filtering", () => {
		it("filters by includeRegionCodes", () => {
			const result = applyFilters(sampleFilenames, {
				includeRegionCodes: ["us"],
			})

			expect(result.every(f => f.includes("USA"))).toBe(true)
		})

		it("filters by excludeRegionCodes", () => {
			const result = applyFilters(sampleFilenames, {
				excludeRegionCodes: ["jp"],
			})

			expect(result.some(f => f.includes("Japan"))).toBe(false)
		})

		it("handles multiple region codes", () => {
			const result = applyFilters(sampleFilenames, {
				includeRegionCodes: ["us", "eu"],
			})

			expect(result.every(f => f.includes("USA") || f.includes("Europe"))).toBe(
				true,
			)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Exclusion filtering
	// ─────────────────────────────────────────────────────────────────────────

	describe("exclusion filtering", () => {
		it("excludes prerelease by default", () => {
			const result = applyFilters(sampleFilenames, {
				exclusion: {
					includePrerelease: false,
					includeUnlicensed: true,
					includeHacks: true,
					includeHomebrew: true,
				},
			})

			expect(result.some(f => f.includes("Beta"))).toBe(false)
			expect(result.some(f => f.includes("Proto"))).toBe(false)
		})

		it("excludes unlicensed when configured", () => {
			const result = applyFilters(sampleFilenames, {
				exclusion: {
					includePrerelease: true,
					includeUnlicensed: false,
					includeHacks: true,
					includeHomebrew: true,
				},
			})

			expect(result.some(f => f.includes("Unl"))).toBe(false)
		})

		it("excludes hacks when configured", () => {
			const result = applyFilters(sampleFilenames, {
				exclusion: {
					includePrerelease: true,
					includeUnlicensed: true,
					includeHacks: false,
					includeHomebrew: true,
				},
			})

			expect(result.some(f => f.includes("Hack"))).toBe(false)
		})

		it("excludes homebrew when configured", () => {
			const result = applyFilters(sampleFilenames, {
				exclusion: {
					includePrerelease: true,
					includeUnlicensed: true,
					includeHacks: true,
					includeHomebrew: false,
				},
			})

			expect(result.some(f => f.includes("Homebrew"))).toBe(false)
		})

		it("includes all when all flags true", () => {
			const result = applyFilters(sampleFilenames, {
				exclusion: {
					includePrerelease: true,
					includeUnlicensed: true,
					includeHacks: true,
					includeHomebrew: true,
				},
			})

			expect(result).toEqual(sampleFilenames)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Pattern filtering
	// ─────────────────────────────────────────────────────────────────────────

	describe("pattern filtering", () => {
		it("filters with includePatterns", () => {
			const result = applyFilters(sampleFilenames, {
				includePatterns: ["Pokemon*"],
			})

			expect(result.every(f => f.startsWith("Pokemon"))).toBe(true)
		})

		it("filters with excludePatterns", () => {
			const result = applyFilters(sampleFilenames, {
				excludePatterns: ["*Beta*", "*Proto*"],
			})

			expect(result.some(f => f.includes("Beta"))).toBe(false)
			expect(result.some(f => f.includes("Proto"))).toBe(false)
		})

		it("supports wildcard patterns", () => {
			const result = applyFilters(sampleFilenames, {
				includePatterns: ["*Red*"],
			})

			expect(result.every(f => f.includes("Red"))).toBe(true)
		})
	})
})

describe("calculatePriority", () => {
	it("returns higher value for preferred regions", () => {
		const euPriority = calculatePriority("Game (Europe).gb")
		const usPriority = calculatePriority("Game (USA).gb")
		const jpPriority = calculatePriority("Game (Japan).gb")

		expect(euPriority).toBeGreaterThan(usPriority)
		expect(usPriority).toBeGreaterThan(jpPriority)
	})

	it("factors in version/revision", () => {
		const rev2Priority = calculatePriority("Game (USA) (Rev 2).nes")
		const rev1Priority = calculatePriority("Game (USA) (Rev 1).nes")
		const noPriority = calculatePriority("Game (USA).nes")

		expect(rev2Priority).toBeGreaterThan(rev1Priority)
		expect(rev1Priority).toBeGreaterThan(noPriority)
	})

	it("respects custom region priority", () => {
		const jpPriority = calculatePriority("Game (Japan).gb", {
			regionPriority: ["jp", "us", "eu"],
		})
		const usPriority = calculatePriority("Game (USA).gb", {
			regionPriority: ["jp", "us", "eu"],
		})

		expect(jpPriority).toBeGreaterThan(usPriority)
	})
})

describe("getPresetFilter", () => {
	it("returns regex for usa preset", () => {
		const filter = getPresetFilter("usa")
		expect(filter).toBeInstanceOf(RegExp)
		expect(filter?.test("Game (USA).gb")).toBe(true)
		expect(filter?.test("Game (Japan).gb")).toBe(false)
	})

	it("returns regex for english preset", () => {
		const filter = getPresetFilter("english")
		expect(filter?.test("Game (USA).gb")).toBe(true)
		expect(filter?.test("Game (Europe).gb")).toBe(true)
		expect(filter?.test("Game (World).gb")).toBe(true)
	})

	it("returns null for all preset", () => {
		const filter = getPresetFilter("all")
		expect(filter).toBeNull()
	})
})

describe("getExclusionFilter", () => {
	it("returns null when all included", () => {
		const filter = getExclusionFilter({
			includePrerelease: true,
			includeUnlicensed: true,
			includeHacks: true,
			includeHomebrew: true,
		})
		expect(filter).toBeNull()
	})

	it("returns regex matching excluded patterns", () => {
		const filter = getExclusionFilter({
			includePrerelease: false,
			includeUnlicensed: false,
			includeHacks: true,
			includeHomebrew: true,
		})

		expect(filter).toBeInstanceOf(RegExp)
		expect(filter?.test("Game (Beta).gb")).toBe(true)
		expect(filter?.test("Game (Unl).gb")).toBe(true)
		expect(filter?.test("Game (USA).gb")).toBe(false)
	})
})

describe("parsePatternList", () => {
	it("parses comma-separated patterns", () => {
		const result = parsePatternList("*.gb,*.gba,*.nes")
		expect(result).toEqual(["*.gb", "*.gba", "*.nes"])
	})

	it("handles escaped commas", () => {
		const result = parsePatternList("Game\\, The,Other")
		expect(result).toEqual(["Game, The", "Other"])
	})

	it("trims whitespace", () => {
		const result = parsePatternList(" *.gb , *.gba ")
		expect(result).toEqual(["*.gb", "*.gba"])
	})

	it("returns empty array for undefined", () => {
		const result = parsePatternList(undefined)
		expect(result).toEqual([])
	})
})

describe("priority constants", () => {
	it("DEFAULT_REGION_PRIORITY has expected order", () => {
		const euIndex = DEFAULT_REGION_PRIORITY.indexOf("eu")
		const usIndex = DEFAULT_REGION_PRIORITY.indexOf("us")
		const jpIndex = DEFAULT_REGION_PRIORITY.indexOf("jp")

		// Lower index = higher priority
		expect(euIndex).toBeLessThan(usIndex)
		expect(usIndex).toBeLessThan(jpIndex)
	})

	it("DEFAULT_LANGUAGE_PRIORITY has english first", () => {
		expect(DEFAULT_LANGUAGE_PRIORITY[0]).toBe("en")
	})
})
