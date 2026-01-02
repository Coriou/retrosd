/**
 * Interactive prompts using the prompts library
 */

import prompts from "prompts"
import type { Source, RomEntry, RegionPreset } from "./types.js"
import { getEntriesBySources } from "./roms.js"
import type { UserPreferences } from "./preferences.js"

/**
 * Prompt user to confirm ROM download
 */
export async function promptConfirmRomDownload(
	savedPrefs?: UserPreferences,
): Promise<boolean> {
	const response = await prompts({
		type: "confirm",
		name: "confirm",
		message: "Download ROMs now?",
		initial: savedPrefs?.confirmRomDownload ?? false,
	})

	return response.confirm === true
}

/**
 * Prompt user to select ROM sources
 */
export async function promptSources(
	savedPrefs?: UserPreferences,
): Promise<Source[]> {
	const savedSources = savedPrefs?.sources ?? []
	const response = await prompts({
		type: "multiselect",
		name: "sources",
		message: "Select ROM sources",
		choices: [
			{
				title: "No-Intro (cartridge dumps)",
				value: "no-intro",
				selected:
					savedSources.length > 0 ? savedSources.includes("no-intro") : true,
			},
			{
				title: "Redump (disc images)",
				value: "redump",
				selected: savedSources.includes("redump"),
			},
		],
		hint: "- Space to select. Return to submit",
		instructions: false,
	})

	// Default to no-intro if nothing selected
	if (!response.sources || response.sources.length === 0) {
		return ["no-intro"]
	}

	return response.sources as Source[]
}

/**
 * Prompt user to select systems based on available sources
 */
export async function promptSystems(
	sources: Source[],
	savedPrefs?: UserPreferences,
): Promise<RomEntry[]> {
	const availableEntries = getEntriesBySources(sources)

	if (availableEntries.length === 0) {
		return []
	}

	const savedSystems = savedPrefs?.systems ?? []
	const hasSavedSystems = savedSystems.length > 0

	const response = await prompts({
		type: "multiselect",
		name: "systems",
		message: "Select systems to download",
		choices: availableEntries.map(entry => ({
			title: `${entry.label} [${entry.source}]`,
			value: entry.key,
			selected: hasSavedSystems ? savedSystems.includes(entry.key) : true,
		})),
		hint: "- Space to select. Return to submit",
		instructions: false,
	})

	// Default to all if nothing selected
	if (!response.systems || response.systems.length === 0) {
		return availableEntries
	}

	return availableEntries.filter(e =>
		(response.systems as string[]).includes(e.key),
	)
}

/**
 * Prompt user to select a filter preset
 */
export async function promptFilter(
	savedPrefs?: UserPreferences,
): Promise<{ preset?: RegionPreset; custom?: string }> {
	const presetChoices = [
		{ title: "USA only - (USA) ROMs", value: "usa" },
		{
			title: "English regions - (USA), (Europe), (World), (Australia)",
			value: "english",
		},
		{ title: "NTSC regions - (USA), (Japan), (Korea)", value: "ntsc" },
		{
			title: "PAL regions - (Europe), (Australia), (Germany), (France)",
			value: "pal",
		},
		{ title: "Japanese only - (Japan) ROMs", value: "japanese" },
		{ title: "Complete (no filter) - All ROMs", value: "all" },
		{ title: "Custom regex - Enter your own pattern", value: "custom" },
	]

	// Determine initial selection based on saved preferences
	let initialIndex = 5 // Default to "Complete (all)"
	if (savedPrefs?.customFilter) {
		initialIndex = 6 // custom
	} else if (savedPrefs?.preset) {
		const idx = presetChoices.findIndex(c => c.value === savedPrefs.preset)
		if (idx >= 0) initialIndex = idx
	}

	const response = await prompts({
		type: "select",
		name: "filter",
		message: "Select region filter",
		choices: presetChoices,
		initial: initialIndex,
	})

	if (response.filter === "custom") {
		const customResponse = await prompts({
			type: "text",
			name: "pattern",
			message: 'Enter filter regex (e.g. "(USA|Europe)")',
			initial: savedPrefs?.customFilter ?? "",
		})

		return { custom: customResponse.pattern as string }
	}

	if (response.filter && response.filter !== "all") {
		return { preset: response.filter as RegionPreset }
	}

	// Return 'all' explicitly so we can save it
	return { preset: "all" as RegionPreset }
}

/**
 * Handle Ctrl+C gracefully
 */
export function setupPromptHandlers(): void {
	prompts.override({})

	// Handle Ctrl+C
	process.on("SIGINT", () => {
		console.log("\n\nAborted.")
		process.exit(0)
	})
}
