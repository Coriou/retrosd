/**
 * Region filter presets and exclusion patterns
 * Fixed from the buggy bash implementation that mixed BRE/ERE syntax
 */

import type { RegionPreset } from './types.js'

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

  return new RegExp(patterns.join('|'), 'i')
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
  }
): string[] {
  let results = filenames

  // Apply region filter (include only matching)
  if (options.regionFilter) {
    results = results.filter((f) => options.regionFilter!.test(f))
  }

  // Apply exclusion filter (exclude matching)
  if (options.exclusionFilter) {
    results = results.filter((f) => !options.exclusionFilter!.test(f))
  }

  return results
}
