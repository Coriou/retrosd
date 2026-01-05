import test from "node:test"
import assert from "node:assert/strict"

import { computeScanStats } from "../src/scan/stats.js"
import type { CollectionManifest } from "../src/types.js"

await test("computeScanStats computes coverage/regions/tags/variants", async () => {
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

	assert.equal(stats.totals.roms, 4)
	assert.equal(stats.coverage.withMetadata, 2)
	assert.equal(stats.coverage.hasSha1, 1)
	assert.equal(stats.coverage.hasCrc32, 1)

	assert.equal(stats.tags.prerelease, 1)
	assert.equal(stats.tags.unlicensed, 1)
	assert.equal(stats.tags.hack, 1)
	assert.equal(stats.tags.homebrew, 0)

	const regionMap = new Map(stats.regions.overall.map(r => [r.region, r.count]))
	assert.equal(regionMap.get("World"), 2)
	assert.equal(regionMap.get("USA"), 1)
	assert.equal(regionMap.get("Unknown"), 1)

	assert.equal(stats.duplicates.titlesWithVariants, 1)
	assert.equal(stats.duplicates.topTitles[0]?.title, "Tetris")
	assert.equal(stats.duplicates.topTitles[0]?.variants, 2)
})
