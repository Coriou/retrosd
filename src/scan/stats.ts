import type { CollectionManifest, RomInfo } from "../types.js"
import { parseRomFilenameParts } from "../romname.js"

export interface ScanStats {
	totals: {
		roms: number
		bytes: number
		systems: number
	}
	coverage: {
		withMetadata: number
		hasSha1: number
		hasCrc32: number
	}
	regions: {
		overall: Array<{ region: string; count: number }>
		perSystem: Record<string, Array<{ region: string; count: number }>>
	}
	tags: {
		prerelease: number
		unlicensed: number
		hack: number
		homebrew: number
	}
	duplicates: {
		/** Number of unique titles which have more than one ROM variant */
		titlesWithVariants: number
		/** Top titles by variant count */
		topTitles: Array<{ title: string; variants: number }>
	}
	hashDuplicates: {
		sha1: { groups: number; extraCopies: number }
		crc32: { groups: number; extraCopies: number }
	}
}

function sortCountsDesc<T extends { count: number }>(
	a: T & { region?: string },
	b: T & { region?: string },
): number {
	if (b.count !== a.count) return b.count - a.count
	const aKey = (a.region ?? "").toLowerCase()
	const bKey = (b.region ?? "").toLowerCase()
	return aKey.localeCompare(bKey)
}

function normalizeTitleForGrouping(title: string): string {
	return title
		.trim()
		.toLowerCase()
		.replace(/[\u2010-\u2015]/g, "-")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

function bump(map: Map<string, number>, key: string, amount = 1): void {
	map.set(key, (map.get(key) ?? 0) + amount)
}

function countRegions(rom: RomInfo, regionCounts: Map<string, number>): void {
	const regions = rom.region?.length ? rom.region : ["Unknown"]
	for (const region of regions) {
		bump(regionCounts, region || "Unknown")
	}
}

export function computeScanStats(
	manifest: CollectionManifest,
	options: { topN?: number } = {},
): ScanStats {
	const topN = options.topN ?? 8

	let roms = 0
	let bytes = 0
	let withMetadata = 0
	let hasSha1 = 0
	let hasCrc32 = 0

	let prerelease = 0
	let unlicensed = 0
	let hack = 0
	let homebrew = 0

	const overallRegionCounts = new Map<string, number>()
	const perSystemRegionCounts = new Map<string, Map<string, number>>()

	const titleCounts = new Map<
		string,
		{ displayTitle: string; variants: number }
	>()

	const sha1Counts = new Map<string, number>()
	const crc32Counts = new Map<string, number>()

	for (const system of manifest.systems) {
		const systemRegions = new Map<string, number>()
		for (const rom of system.roms) {
			roms += 1
			bytes += rom.size

			if (rom.hasMetadata) withMetadata += 1
			if (rom.sha1) hasSha1 += 1
			if (rom.crc32) hasCrc32 += 1

			if (rom.sha1) bump(sha1Counts, rom.sha1)
			if (rom.crc32) bump(crc32Counts, rom.crc32)

			countRegions(rom, overallRegionCounts)
			countRegions(rom, systemRegions)

			// Tags/flags are derived from filename parsing; no extra I/O.
			const parsed = parseRomFilenameParts(rom.filename)
			if (parsed.flags.prerelease) prerelease += 1
			if (parsed.flags.unlicensed) unlicensed += 1
			if (parsed.flags.hack) hack += 1
			if (parsed.flags.homebrew) homebrew += 1

			const normalized = normalizeTitleForGrouping(rom.title || parsed.title)
			if (normalized) {
				const existing = titleCounts.get(normalized)
				if (existing) {
					existing.variants += 1
				} else {
					titleCounts.set(normalized, {
						displayTitle: rom.title || parsed.title,
						variants: 1,
					})
				}
			}
		}
		perSystemRegionCounts.set(system.system, systemRegions)
	}

	const overallRegions = Array.from(overallRegionCounts.entries())
		.map(([region, count]) => ({ region, count }))
		.sort(sortCountsDesc)
		.slice(0, topN)

	const perSystem: Record<string, Array<{ region: string; count: number }>> = {}
	for (const [system, counts] of perSystemRegionCounts.entries()) {
		perSystem[system] = Array.from(counts.entries())
			.map(([region, count]) => ({ region, count }))
			.sort(sortCountsDesc)
			.slice(0, Math.min(5, topN))
	}

	const titles = Array.from(titleCounts.values())
	const titlesWithVariants = titles.filter(t => t.variants > 1).length
	const topTitles = titles
		.filter(t => t.variants > 1)
		.sort((a, b) => {
			if (b.variants !== a.variants) return b.variants - a.variants
			return a.displayTitle.localeCompare(b.displayTitle)
		})
		.slice(0, Math.min(10, topN))
		.map(t => ({ title: t.displayTitle, variants: t.variants }))

	const summarizeHashCounts = (counts: Map<string, number>) => {
		let groups = 0
		let extraCopies = 0
		for (const count of counts.values()) {
			if (count > 1) {
				groups += 1
				extraCopies += count - 1
			}
		}
		return { groups, extraCopies }
	}

	return {
		totals: {
			roms,
			bytes,
			systems: manifest.systems.length,
		},
		coverage: {
			withMetadata,
			hasSha1,
			hasCrc32,
		},
		regions: {
			overall: overallRegions,
			perSystem,
		},
		tags: {
			prerelease,
			unlicensed,
			hack,
			homebrew,
		},
		duplicates: {
			titlesWithVariants,
			topTitles,
		},
		hashDuplicates: {
			sha1: summarizeHashCounts(sha1Counts),
			crc32: summarizeHashCounts(crc32Counts),
		},
	}
}
