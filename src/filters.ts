/**
 * Region filter presets and exclusion patterns
 * Enhanced with priority scoring for smart 1G1R (one-game-one-ROM) selection
 */

import type { RegionPreset } from "./types.js"

/**
 * Region priority scores for 1G1R selection
 * Higher scores = preferred regions when duplicates exist
 */
export const REGION_PRIORITY: Record<string, number> = {
	USA: 100,
	World: 95,
	En: 90,
	Europe: 85,
	Australia: 80,
	Japan: 75,
	Asia: 70,
	Korea: 65,
	Germany: 60,
	France: 55,
	Spain: 50,
	Italy: 45,
	Brazil: 40,
	China: 35,
	Netherlands: 30,
	Sweden: 25,
}

/**
 * Version/revision priority
 * Prefer newer revisions when available
 */
export const VERSION_PRIORITY: Record<string, number> = {
	"Rev 3": 30,
	"Rev 2": 20,
	"Rev 1": 10,
	"Rev A": 15,
	"Rev B": 12,
	"Rev C": 10,
	"v1.2": 22,
	"v1.1": 11,
	"v1.0": 5,
}

/**
 * Region presets - properly escaped for JavaScript RegExp
 * The bash script used mixed styles: \(USA\) (BRE) vs (USA) (ERE)
 * This caused filters to not match correctly
 */
export const REGION_PRESETS: Record<RegionPreset, RegExp | null> = {
	usa: /\(USA\)/,
	english: /\((USA|Europe|World|Australia|En)\)/,
	ntsc: /\((USA|Japan|Korea)\)/,
	pal: /\((Europe|Australia|Germany|France|Spain|Italy|Netherlands|Sweden)\)/,
	japanese: /\(Japan\)/,
	all: null, // null means no filter (match everything)
}

/**
 * Exclusion patterns for pre-release and unlicensed content
 */
export const EXCLUSION_PATTERNS = {
	prerelease: /\((Beta|Demo|Proto|Sample|Preview)\)/i,
	unlicensed: /\((Unl|Pirate|Bootleg)\)/i,
}

/**
 * Get the filter regex for a preset
 */
export function getPresetFilter(preset: RegionPreset): RegExp | null {
	return REGION_PRESETS[preset]
}

/**
 * Build a combined exclusion regex based on options
 */
export function getExclusionFilter(options: {
	includePrerelease: boolean
	includeUnlicensed: boolean
}): RegExp | null {
	const patterns: string[] = []

	if (!options.includePrerelease) {
		patterns.push(EXCLUSION_PATTERNS.prerelease.source)
	}

	if (!options.includeUnlicensed) {
		patterns.push(EXCLUSION_PATTERNS.unlicensed.source)
	}

	if (patterns.length === 0) {
		return null
	}

	return new RegExp(patterns.join("|"), "i")
}

/**
 * Parse a custom filter string into a RegExp
 * Handles user-provided patterns that might already have escapes or not
 */
export function parseCustomFilter(filter: string): RegExp {
	// If it looks like the user intended literal parentheses, keep them
	// Otherwise, treat as a standard regex
	return new RegExp(filter)
}

/**
 * Filter a list of filenames using the given filters
 */
export function applyFilters(
	filenames: string[],
	options: {
		regionFilter: RegExp | null
		exclusionFilter: RegExp | null
	},
): string[] {
	let results = filenames

	// Apply region filter (include only matching)
	if (options.regionFilter) {
		results = results.filter(f => options.regionFilter!.test(f))
	}

	// Apply exclusion filter (exclude matching)
	if (options.exclusionFilter) {
		results = results.filter(f => !options.exclusionFilter!.test(f))
	}

	return results
}

/**
 * Extract regions from filename
 */
function extractRegions(filename: string): string[] {
	const matches = filename.match(/\(([^)]+)\)/g) || []
	return matches
		.map(m => m.slice(1, -1))
		.filter(r => REGION_PRIORITY[r] !== undefined)
}

/**
 * Extract version/revision from filename
 */
function extractVersion(filename: string): string | null {
	const match = filename.match(/\((Rev|v)\s*[\dA-Za-z.]+\)/i)
	return match ? match[0].slice(1, -1) : null
}

/**
 * Calculate priority score for a ROM filename
 * Used for 1G1R (one-game-one-ROM) selection
 */
export function calculatePriority(filename: string): number {
	let score = 0

	// Region priority (highest region wins)
	const regions = extractRegions(filename)
	if (regions.length > 0) {
		score += Math.max(...regions.map(r => REGION_PRIORITY[r] || 0))
	}

	// Version priority
	const version = extractVersion(filename)
	if (version) {
		score += VERSION_PRIORITY[version] || 0
	}

	return score
}

/**
 * Extract base game name without region/version tags
 */
function extractGameName(filename: string): string {
	// Remove everything from first parenthesis onward
	const match = filename.match(/^([^(]+)/)
	return match ? match[1]!.trim() : filename
}

/**
 * Apply 1G1R (one-game-one-ROM) filtering
 * Keeps only the highest priority version of each game
 */
export function apply1G1R(filenames: string[]): string[] {
	const gameMap = new Map<string, { filename: string; priority: number }>()

	for (const filename of filenames) {
		const gameName = extractGameName(filename)
		const priority = calculatePriority(filename)

		const existing = gameMap.get(gameName)
		if (!existing || priority > existing.priority) {
			gameMap.set(gameName, { filename, priority })
		}
	}

	return Array.from(gameMap.values()).map(entry => entry.filename)
}
