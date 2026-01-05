/**
 * Region filter presets and smart 1G1R (one-game-one-ROM) selection helpers.
 */

import { readFileSync } from "node:fs"
import { basename } from "node:path"
import type { RegionPreset } from "./types.js"
import {
	parseRomFilenameParts,
	normalizeRegionCode,
	normalizeLanguageCode,
	type ParsedRomName,
	type VersionInfo,
	REGION_CODE_LABELS,
} from "./romname.js"

export const DEFAULT_REGION_PRIORITY = [
	"eu",
	"us",
	"ss",
	"uk",
	"wor",
	"jp",
	"au",
	"ame",
	"de",
	"cus",
	"cn",
	"kr",
	"asi",
	"br",
	"sp",
	"fr",
	"gr",
	"it",
	"no",
	"dk",
	"nz",
	"nl",
	"pl",
	"ru",
	"se",
	"tw",
	"ca",
]

export const DEFAULT_LANGUAGE_PRIORITY = ["en", "de", "fr", "es"]

const LEGACY_VERSION_PRIORITY: Record<string, number> = {
	"rev 3": 30,
	"rev 2": 20,
	"rev 1": 10,
	"rev a": 15,
	"rev b": 12,
	"rev c": 10,
	"v1.2": 22,
	"v1.1": 11,
	"v1.0": 5,
}

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

export const REGION_PRIORITY: Record<string, number> = (() => {
	const map: Record<string, number> = {}
	const total = DEFAULT_REGION_PRIORITY.length
	for (const [index, code] of DEFAULT_REGION_PRIORITY.entries()) {
		const rank = total - index
		map[code] = rank
		const label = REGION_CODE_LABELS[code]
		if (label) map[label] = rank
	}
	return map
})()

function buildPresetRegex(tokens: string[]): RegExp {
	const fragments = tokens.map(token => {
		const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		if (/^[A-Za-z0-9]+$/.test(token)) {
			return `\\b${escaped}\\b`
		}
		return escaped
	})
	return new RegExp(`\\(([^)]*(?:${fragments.join("|")})[^)]*)\\)`, "i")
}

export const REGION_PRESETS: Record<RegionPreset, RegExp | null> = {
	usa: buildPresetRegex(["USA", "US"]),
	english: buildPresetRegex([
		"USA",
		"US",
		"Europe",
		"World",
		"Australia",
		"UK",
		"United Kingdom",
		"Canada",
		"En",
	]),
	ntsc: buildPresetRegex(["USA", "US", "Japan", "Korea"]),
	pal: buildPresetRegex([
		"Europe",
		"Australia",
		"Germany",
		"France",
		"Spain",
		"Italy",
		"Netherlands",
		"Sweden",
		"UK",
		"United Kingdom",
	]),
	japanese: buildPresetRegex(["Japan"]),
	all: null,
}

export const EXCLUSION_PATTERNS = {
	prerelease:
		/\([^)]*(Beta|Demo|Proto|Sample|Preview|Alpha|Pre-Release|Prototype)[^)]*\)/i,
	unlicensed: /\([^)]*(Unl|Unlicensed|Pirate|Bootleg)[^)]*\)/i,
	hacks: /\([^)]*(Hack|Hacked|Romhack)[^)]*\)/i,
	homebrew: /\([^)]*(Homebrew|Home Brew)[^)]*\)/i,
}

export interface ExclusionOptions {
	includePrerelease: boolean
	includeUnlicensed: boolean
	includeHacks: boolean
	includeHomebrew: boolean
}

export interface FilenameFilterOptions {
	nameFilter?: RegExp | null
	regionFilter?: RegExp | null
	exclusionFilter?: RegExp | null
	includePatterns?: string[]
	excludePatterns?: string[]
	/** Only keep files that match at least one of these parsed region codes (e.g. eu, us). */
	includeRegionCodes?: string[]
	/** Drop files that match any of these parsed region codes (e.g. jp). */
	excludeRegionCodes?: string[]
	/** Only keep files that match at least one of these parsed language codes (e.g. en, fr). */
	includeLanguageCodes?: string[]
	/** Drop files that match any of these parsed language codes (e.g. es). */
	excludeLanguageCodes?: string[]
	/**
	 * When language tags are missing from the filename, infer language codes from
	 * unambiguous region codes (e.g. us -> en, fr -> fr). This only applies when
	 * include/exclude language filters are used.
	 */
	inferLanguageCodes?: boolean
	includeList?: Set<string>
	excludeList?: Set<string>
	exclusion?: ExclusionOptions
}

const IMPLIED_LANGUAGES_BY_REGION: Readonly<Record<string, readonly string[]>> =
	Object.freeze({
		us: ["en"],
		uk: ["en"],
		au: ["en"],
		jp: ["ja"],
		fr: ["fr"],
		de: ["de"],
		it: ["it"],
		sp: ["es"],
		br: ["pt"],
		cn: ["zh"],
		tw: ["zh"],
		kr: ["ko"],
		ru: ["ru"],
		pl: ["pl"],
	})

function inferLanguagesFromRegionCodes(
	regionCodes: readonly string[],
): string[] {
	const inferred = new Set<string>()
	for (const regionCode of regionCodes) {
		const langs = IMPLIED_LANGUAGES_BY_REGION[regionCode]
		if (!langs) continue
		for (const lang of langs) inferred.add(lang)
	}
	return inferred.size > 0 ? Array.from(inferred) : []
}

export interface PriorityOptions {
	preferredRegion?: string
	regionPriority?: string[]
	preferredLanguage?: string
	languagePriority?: string[]
}

export function getPresetFilter(preset: RegionPreset): RegExp | null {
	return REGION_PRESETS[preset]
}

export function getExclusionFilter(options: ExclusionOptions): RegExp | null {
	const patterns: string[] = []
	if (!options.includePrerelease)
		patterns.push(EXCLUSION_PATTERNS.prerelease.source)
	if (!options.includeUnlicensed)
		patterns.push(EXCLUSION_PATTERNS.unlicensed.source)
	if (!options.includeHacks) patterns.push(EXCLUSION_PATTERNS.hacks.source)
	if (!options.includeHomebrew)
		patterns.push(EXCLUSION_PATTERNS.homebrew.source)
	if (patterns.length === 0) return null
	return new RegExp(patterns.join("|"), "i")
}

export function parseCustomFilter(filter: string): RegExp {
	const trimmed = filter.trim()
	const match = trimmed.match(/^\/(.+)\/([gimsuy]*)$/)
	try {
		if (match) {
			return new RegExp(match[1] ?? "", match[2] ?? "")
		}
		return new RegExp(trimmed)
	} catch (err) {
		throw new Error(
			`Invalid regex "${filter}": ${err instanceof Error ? err.message : String(err)}`,
		)
	}
}

function normalizeFilterKey(filename: string): string {
	return filename.trim().toLowerCase()
}

export function parsePatternList(input?: string): string[] {
	if (!input) return []
	const patterns: string[] = []
	let current = ""
	let escaped = false
	for (const ch of input) {
		if (escaped) {
			current += ch
			escaped = false
			continue
		}
		if (ch === "\\") {
			escaped = true
			continue
		}
		if (ch === ",") {
			if (current.trim()) patterns.push(current.trim())
			current = ""
			continue
		}
		current += ch
	}
	if (current.trim()) patterns.push(current.trim())
	return patterns
}

function globToRegex(pattern: string): RegExp {
	const placeholderStar = "\u0000"
	const placeholderQ = "\u0001"
	const withPlaceholders = pattern
		.replace(/\*/g, placeholderStar)
		.replace(/\?/g, placeholderQ)
	const escaped = withPlaceholders.replace(/[.+^${}()|[\]\\]/g, "\\$&")
	const regexSource =
		"^" +
		escaped
			.replace(new RegExp(placeholderStar, "g"), ".*")
			.replace(new RegExp(placeholderQ, "g"), ".") +
		"$"
	return new RegExp(regexSource, "i")
}

function compilePatterns(patterns?: string[]): RegExp[] {
	if (!patterns || patterns.length === 0) return []
	return patterns
		.map(p => p.trim())
		.filter(Boolean)
		.map(globToRegex)
}

export function loadFilterList(filePath: string): Set<string> {
	const raw = readFileSync(filePath, "utf8")
	const lines = raw.split(/\r?\n/)
	const out = new Set<string>()
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) continue
		const cleaned = trimmed.replace(/^["']|["']$/g, "")
		const name = basename(cleaned)
		if (name) out.add(normalizeFilterKey(name))
	}
	return out
}

function _shouldExclude(filename: string, rules: ExclusionOptions): boolean {
	if (
		rules.includePrerelease &&
		rules.includeUnlicensed &&
		rules.includeHacks &&
		rules.includeHomebrew
	) {
		return false
	}
	const parsed = parseRomFilenameParts(filename)
	if (!rules.includePrerelease && parsed.flags.prerelease) return true
	if (!rules.includeUnlicensed && parsed.flags.unlicensed) return true
	if (!rules.includeHacks && parsed.flags.hack) return true
	if (!rules.includeHomebrew && parsed.flags.homebrew) return true
	return false
}

export function applyFilters(
	filenames: string[],
	options: FilenameFilterOptions,
): string[] {
	const includeRegexes = compilePatterns(options.includePatterns)
	const excludeRegexes = compilePatterns(options.excludePatterns)
	const hasIncludeList = !!options.includeList && options.includeList.size > 0
	const hasExcludeList = !!options.excludeList && options.excludeList.size > 0
	const nameFilter = options.nameFilter ?? options.regionFilter ?? null
	const hasNameFilter = !!nameFilter
	const exclusionFilter = options.exclusionFilter ?? null
	const hasIncludePatterns = includeRegexes.length > 0
	const hasExcludePatterns = excludeRegexes.length > 0
	const rules = options.exclusion

	const normalizeCodeSet = (
		values: string[] | undefined,
		normalizer: (value: string) => string | null,
	): Set<string> | null => {
		if (!values || values.length === 0) return null
		const out = new Set<string>()
		for (const value of values) {
			const code = normalizer(value)
			if (code) out.add(code)
		}
		return out.size > 0 ? out : null
	}

	const includeRegionSet = normalizeCodeSet(
		options.includeRegionCodes,
		normalizeRegionCode,
	)
	const excludeRegionSet = normalizeCodeSet(
		options.excludeRegionCodes,
		normalizeRegionCode,
	)
	const includeLanguageSet = normalizeCodeSet(
		options.includeLanguageCodes,
		normalizeLanguageCode,
	)
	const excludeLanguageSet = normalizeCodeSet(
		options.excludeLanguageCodes,
		normalizeLanguageCode,
	)
	const inferLanguageCodes = options.inferLanguageCodes ?? true
	const hasTagFilters =
		!!includeRegionSet ||
		!!excludeRegionSet ||
		!!includeLanguageSet ||
		!!excludeLanguageSet

	const matchAny = (values: string[], set: Set<string>): boolean => {
		for (const value of values) {
			if (set.has(value)) return true
		}
		return false
	}

	return filenames.filter(filename => {
		const key = normalizeFilterKey(filename)
		const needsParsed = hasTagFilters || !!rules
		const parsed = needsParsed ? parseRomFilenameParts(filename) : null

		if (hasTagFilters && parsed) {
			if (includeRegionSet && !matchAny(parsed.regionCodes, includeRegionSet)) {
				return false
			}
			if (excludeRegionSet && matchAny(parsed.regionCodes, excludeRegionSet)) {
				return false
			}
			if (includeLanguageSet || excludeLanguageSet) {
				const effectiveLanguages =
					inferLanguageCodes && parsed.languages.length === 0
						? inferLanguagesFromRegionCodes(parsed.regionCodes)
						: parsed.languages

				if (
					includeLanguageSet &&
					!matchAny(effectiveLanguages, includeLanguageSet)
				) {
					return false
				}
				if (
					excludeLanguageSet &&
					matchAny(effectiveLanguages, excludeLanguageSet)
				) {
					return false
				}
			}
		}

		if (rules && parsed) {
			if (
				rules.includePrerelease &&
				rules.includeUnlicensed &&
				rules.includeHacks &&
				rules.includeHomebrew
			) {
				// No exclusion by content flags
			} else {
				if (!rules.includePrerelease && parsed.flags.prerelease) return false
				if (!rules.includeUnlicensed && parsed.flags.unlicensed) return false
				if (!rules.includeHacks && parsed.flags.hack) return false
				if (!rules.includeHomebrew && parsed.flags.homebrew) return false
			}
		}

		if (hasIncludeList && !options.includeList!.has(key)) return false
		if (hasIncludePatterns && !includeRegexes.some(re => re.test(filename)))
			return false
		if (hasNameFilter) {
			const filter = nameFilter!
			if (filter.global || filter.sticky) filter.lastIndex = 0
			if (!filter.test(filename)) return false
		}
		if (exclusionFilter) {
			if (exclusionFilter.global || exclusionFilter.sticky)
				exclusionFilter.lastIndex = 0
			if (exclusionFilter.test(filename)) return false
		}
		if (hasExcludeList && options.excludeList!.has(key)) return false
		if (hasExcludePatterns && excludeRegexes.some(re => re.test(filename)))
			return false
		return true
	})
}

function uniqueList(items: string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const item of items) {
		if (seen.has(item)) continue
		seen.add(item)
		out.push(item)
	}
	return out
}

function resolvePriorityList(
	defaultList: string[],
	overrideList: string[] | undefined,
	preferred: string | undefined,
	normalizer: (value: string) => string | null,
): string[] {
	const base =
		overrideList && overrideList.length > 0 ? overrideList : defaultList
	const normalizedBase = uniqueList(
		base
			.map(value => normalizer(value))
			.filter((value): value is string => !!value),
	)
	const normalizedFallback = uniqueList(
		defaultList
			.map(value => normalizer(value))
			.filter((value): value is string => !!value),
	)
	const normalized =
		normalizedBase.length > 0 ? normalizedBase : normalizedFallback
	const preferredCode = preferred ? normalizer(preferred) : null
	if (preferredCode) {
		return [preferredCode, ...normalized.filter(code => code !== preferredCode)]
	}
	return normalized
}

function buildPriorityMap(list: string[]): Map<string, number> {
	const map = new Map<string, number>()
	const total = list.length
	for (const [index, code] of list.entries()) {
		map.set(code, total - index)
	}
	return map
}

function getRank(values: string[], map: Map<string, number>): number {
	let rank = 0
	for (const value of values) {
		const score = map.get(value) ?? 0
		if (score > rank) rank = score
	}
	return rank
}

function rankVersion(info?: VersionInfo): number {
	if (!info) return 0
	const legacy = LEGACY_VERSION_PRIORITY[info.raw.toLowerCase()]
	if (legacy !== undefined) return legacy
	let rank = 0
	for (const part of info.parts) {
		rank = rank * 100 + part
	}
	return rank
}

function normalizeTitleKey(title: string): string {
	return title.toLowerCase().replace(/\s+/g, " ").trim()
}

export function calculatePriority(
	filename: string,
	options: PriorityOptions = {},
): number {
	const parsed = parseRomFilenameParts(filename)
	const regionPriority = resolvePriorityList(
		DEFAULT_REGION_PRIORITY,
		options.regionPriority,
		options.preferredRegion,
		normalizeRegionCode,
	)
	const languagePriority = resolvePriorityList(
		DEFAULT_LANGUAGE_PRIORITY,
		options.languagePriority,
		options.preferredLanguage,
		normalizeLanguageCode,
	)
	const regionMap = buildPriorityMap(regionPriority)
	const languageMap = buildPriorityMap(languagePriority)
	const regionRank = getRank(parsed.regionCodes, regionMap)
	const languageRank = getRank(parsed.languages, languageMap)
	const versionRank = rankVersion(parsed.versionInfo)
	return regionRank * 10000 + languageRank * 100 + versionRank
}

interface DiscCandidate {
	filename: string
	versionRank: number
}

interface GroupCandidate {
	regionRank: number
	languageRank: number
	versionRank: number
	discs: Map<string, DiscCandidate>
}

function compareGroups(a: GroupCandidate, b: GroupCandidate): number {
	if (a.regionRank !== b.regionRank) return a.regionRank - b.regionRank
	if (a.languageRank !== b.languageRank) return a.languageRank - b.languageRank
	if (a.versionRank !== b.versionRank) return a.versionRank - b.versionRank
	const discDiff = a.discs.size - b.discs.size
	if (discDiff !== 0) return discDiff
	return 0
}

function buildGroupKey(parsed: ParsedRomName): string {
	const regionKey = parsed.regionCodes.slice().sort().join(",")
	const languageKey = parsed.languages.slice().sort().join(",")
	return `${regionKey}|${languageKey}`
}

function buildDiscKey(parsed: ParsedRomName): string {
	if (!parsed.disc) return "single"
	const { type, index, total } = parsed.disc
	return total ? `${type}:${index}/${total}` : `${type}:${index}`
}

/**
 * Apply 1G1R (one-game-one-ROM) filtering.
 * Keeps the best region/language set per title and preserves all discs.
 */
export function apply1G1R(
	filenames: string[],
	options: PriorityOptions = {},
): string[] {
	if (filenames.length <= 1) return filenames

	const regionPriority = resolvePriorityList(
		DEFAULT_REGION_PRIORITY,
		options.regionPriority,
		options.preferredRegion,
		normalizeRegionCode,
	)
	const languagePriority = resolvePriorityList(
		DEFAULT_LANGUAGE_PRIORITY,
		options.languagePriority,
		options.preferredLanguage,
		normalizeLanguageCode,
	)
	const regionMap = buildPriorityMap(regionPriority)
	const languageMap = buildPriorityMap(languagePriority)

	const titleGroups = new Map<string, Map<string, GroupCandidate>>()

	for (const filename of filenames) {
		const parsed = parseRomFilenameParts(filename)
		const titleKey = normalizeTitleKey(parsed.title)
		const groupKey = buildGroupKey(parsed)
		const discKey = buildDiscKey(parsed)
		const regionRank = getRank(parsed.regionCodes, regionMap)
		const languageRank = getRank(parsed.languages, languageMap)
		const versionRank = rankVersion(parsed.versionInfo)

		let groupMap = titleGroups.get(titleKey)
		if (!groupMap) {
			groupMap = new Map()
			titleGroups.set(titleKey, groupMap)
		}

		let group = groupMap.get(groupKey)
		if (!group) {
			group = {
				regionRank,
				languageRank,
				versionRank,
				discs: new Map(),
			}
			groupMap.set(groupKey, group)
		} else {
			group.regionRank = Math.max(group.regionRank, regionRank)
			group.languageRank = Math.max(group.languageRank, languageRank)
			group.versionRank = Math.max(group.versionRank, versionRank)
		}

		const existingDisc = group.discs.get(discKey)
		if (!existingDisc || versionRank > existingDisc.versionRank) {
			group.discs.set(discKey, { filename, versionRank })
		}
	}

	const selected = new Set<string>()

	for (const groupMap of titleGroups.values()) {
		let bestGroup: GroupCandidate | null = null
		for (const group of groupMap.values()) {
			if (!bestGroup || compareGroups(group, bestGroup) > 0) {
				bestGroup = group
			}
		}
		if (!bestGroup) continue
		for (const disc of bestGroup.discs.values()) {
			selected.add(disc.filename)
		}
	}

	return filenames.filter(name => selected.has(name))
}
