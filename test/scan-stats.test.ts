import { describe, it, expect } from "vitest"

import { computeScanStats } from "../src/scan/stats.js"
import type { CollectionManifest } from "../src/types.js"

describe("computeScanStats", () => {
	it("computes coverage/regions/tags/variants", async () => {
		const manifest: CollectionManifest = {
			version: 1,
			generatedAt: new Date().toISOString(),
			systems: [
				{
					system: "GB",
					source: "no-intro",
					romCount: 3,
					totalSize: 30,
					roms: [
						{
							filename: "Tetris (World) (Beta).gb",
							title: "Tetris",
							region: ["World"],
							size: 10,
							sha1: "a",
							hasMetadata: true,
							path: "/tmp/Tetris.gb",
						},
						{
							filename: "Tetris (World).gb",
							title: "Tetris",
							region: ["World"],
							size: 10,
							crc32: "b",
							hasMetadata: false,
							path: "/tmp/Tetris2.gb",
						},
						{
							filename: "Foo (USA) (Unl).gb",
							title: "Foo",
							region: ["USA"],
							size: 10,
							hasMetadata: false,
							path: "/tmp/Foo.gb",
						},
					],
				},
				{
					system: "GBA",
					source: "no-intro",
					romCount: 1,
					totalSize: 5,
					roms: [
						{
							filename: "Bar (Hack).gba",
							title: "Bar",
							region: [],
							size: 5,
							hasMetadata: true,
							path: "/tmp/Bar.gba",
						},
					],
				},
			],
			stats: {
				totalRoms: 4,
				totalSize: 35,
				systemCount: 2,
				biosCount: 0,
			},
		}

		const stats = computeScanStats(manifest, { topN: 10 })

		expect(stats.totals.roms).toBe(4)
		expect(stats.coverage.withMetadata).toBe(2)
		expect(stats.coverage.hasSha1).toBe(1)
		expect(stats.coverage.hasCrc32).toBe(1)

		expect(stats.tags.prerelease).toBe(1)
		expect(stats.tags.unlicensed).toBe(1)
		expect(stats.tags.hack).toBe(1)
		expect(stats.tags.homebrew).toBe(0)

		const regionMap = new Map(
			stats.regions.overall.map(r => [r.region, r.count]),
		)
		expect(regionMap.get("World")).toBe(2)
		expect(regionMap.get("USA")).toBe(1)
		expect(regionMap.get("Unknown")).toBe(1)

		expect(stats.duplicates.titlesWithVariants).toBe(1)
		expect(stats.duplicates.topTitles[0]?.title).toBe("Tetris")
		expect(stats.duplicates.topTitles[0]?.variants).toBe(2)
	})
})
