/**
 * User preferences persistence
 *
 * Stores selections (sources, systems, filters) in the target directory
 * so they persist between runs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Source, RegionPreset } from "./types.js"

const PREFERENCES_FILE = ".retrosd-preferences.json"

export interface UserPreferences {
	version: number
	sources?: Source[]
	systems?: string[]
	preset?: RegionPreset
	customFilter?: string
	preferredRegion?: string
	regionPriority?: string[]
	preferredLanguage?: string
	languagePriority?: string[]
	includeRegionCodes?: string[]
	includeLanguageCodes?: string[]
	confirmRomDownload?: boolean
	scrape?: boolean
	scrapeMedia?: string[]
	updatedAt?: string
}

const DEFAULT_PREFERENCES: UserPreferences = {
	version: 1,
}

/**
 * Load user preferences from target directory
 */
export function loadPreferences(targetDir: string): UserPreferences {
	const filePath = join(targetDir, PREFERENCES_FILE)

	if (!existsSync(filePath)) {
		return { ...DEFAULT_PREFERENCES }
	}

	try {
		const raw = readFileSync(filePath, "utf8")
		const parsed = JSON.parse(raw) as UserPreferences
		if (parsed && parsed.version === 1) {
			return parsed
		}
	} catch {
		// Corrupted preferences, use defaults
	}

	return { ...DEFAULT_PREFERENCES }
}

/**
 * Save user preferences to target directory
 */
export function savePreferences(
	targetDir: string,
	prefs: UserPreferences,
): void {
	const filePath = join(targetDir, PREFERENCES_FILE)

	try {
		const toSave: UserPreferences = {
			...prefs,
			version: 1,
			updatedAt: new Date().toISOString(),
		}
		writeFileSync(filePath, JSON.stringify(toSave, null, 2), "utf8")
	} catch {
		// Best-effort; don't fail if preferences can't be saved
	}
}

/**
 * Update specific preference fields (merge with existing)
 * When saving `preset`, `customFilter` is automatically cleared and vice versa.
 */
export function updatePreferences(
	targetDir: string,
	updates: Partial<Omit<UserPreferences, "version" | "updatedAt">>,
): void {
	const current = loadPreferences(targetDir)

	// Build merged preferences, conditionally including each field
	const merged: UserPreferences = { version: current.version }

	// Helper to get the final value for a field
	const getValue = <K extends keyof typeof updates>(
		key: K,
	): (typeof updates)[K] | undefined => {
		if (key in updates) {
			return updates[key]
		}
		return current[key as keyof UserPreferences] as (typeof updates)[K]
	}

	const confirmRomDownload = getValue("confirmRomDownload")
	if (confirmRomDownload !== undefined)
		merged.confirmRomDownload = confirmRomDownload

	const scrape = getValue("scrape")
	if (scrape !== undefined) merged.scrape = scrape

	const scrapeMedia = getValue("scrapeMedia")
	if (scrapeMedia !== undefined) merged.scrapeMedia = scrapeMedia

	const sources = getValue("sources")
	if (sources !== undefined) merged.sources = sources

	const systems = getValue("systems")
	if (systems !== undefined) merged.systems = systems

	const preferredRegion = getValue("preferredRegion")
	if (preferredRegion !== undefined) merged.preferredRegion = preferredRegion

	const regionPriority = getValue("regionPriority")
	if (regionPriority !== undefined) merged.regionPriority = regionPriority

	const preferredLanguage = getValue("preferredLanguage")
	if (preferredLanguage !== undefined)
		merged.preferredLanguage = preferredLanguage

	const languagePriority = getValue("languagePriority")
	if (languagePriority !== undefined) merged.languagePriority = languagePriority

	const includeRegionCodes = getValue("includeRegionCodes")
	if (includeRegionCodes !== undefined)
		merged.includeRegionCodes = includeRegionCodes

	const includeLanguageCodes = getValue("includeLanguageCodes")
	if (includeLanguageCodes !== undefined)
		merged.includeLanguageCodes = includeLanguageCodes

	// Preset and customFilter are mutually exclusive
	// If one is being set, don't carry over the other from current
	const settingPreset = "preset" in updates
	const settingCustomFilter = "customFilter" in updates

	if (settingPreset) {
		const preset = updates.preset
		if (preset !== undefined) merged.preset = preset
		// Don't carry over customFilter when preset is being set
	} else if (settingCustomFilter) {
		const customFilter = updates.customFilter
		if (customFilter !== undefined) merged.customFilter = customFilter
		// Don't carry over preset when customFilter is being set
	} else {
		// Neither being set, carry over both from current
		if (current.preset !== undefined) merged.preset = current.preset
		if (current.customFilter !== undefined)
			merged.customFilter = current.customFilter
	}

	savePreferences(targetDir, merged)
}
