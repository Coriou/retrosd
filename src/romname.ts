/**
 * ROM filename parsing helpers.
 * Extracts regions, languages, versions, and release tags from common ROM naming.
 */

export interface VersionInfo {
	kind: "rev" | "ver"
	parts: number[]
	letter?: string
	raw: string
}

export interface DiscInfo {
	type: "disc" | "disk" | "cd" | "gd" | "dvd" | "side" | "part" | "volume"
	index: number
	total?: number
	raw: string
}

export interface ParsedRomName {
	/** Filename without extension */
	baseName: string
	/** Title with trailing tags removed */
	title: string
	/** Region labels (e.g. USA, Europe) */
	regions: string[]
	/** Region codes (e.g. us, eu) */
	regionCodes: string[]
	/** Language codes (e.g. en, fr) */
	languages: string[]
	/** Raw version string (e.g. Rev 1, v1.1) */
	version?: string
	/** Parsed version info */
	versionInfo?: VersionInfo
	/** Tag labels (e.g. Beta, Proto, Hack) */
	tags: string[]
	/** Tag flags */
	flags: {
		prerelease: boolean
		unlicensed: boolean
		hack: boolean
		homebrew: boolean
	}
	/** Disc/part info */
	disc?: DiscInfo
}

export const REGION_CODE_LABELS: Record<string, string> = {
	eu: "Europe",
	us: "USA",
	ss: "ScreenScraper",
	uk: "United Kingdom",
	wor: "World",
	jp: "Japan",
	au: "Australia",
	ame: "America",
	de: "Germany",
	cus: "Custom",
	cn: "China",
	kr: "Korea",
	asi: "Asia",
	br: "Brazil",
	sp: "Spain",
	fr: "France",
	gr: "Greece",
	it: "Italy",
	no: "Norway",
	dk: "Denmark",
	nz: "New Zealand",
	nl: "Netherlands",
	pl: "Poland",
	ru: "Russia",
	se: "Sweden",
	tw: "Taiwan",
	ca: "Canada",
	fi: "Finland",
	oce: "Oceania",
	mor: "Middle East",
}

const REGION_INPUT_ALIASES: Record<string, string> = {
	e: "eu",
	eu: "eu",
	europe: "eu",
	u: "us",
	us: "us",
	usa: "us",
	unitedstates: "us",
	ss: "ss",
	screenscraper: "ss",
	w: "wor",
	wor: "wor",
	world: "wor",
	global: "wor",
	j: "jp",
	jp: "jp",
	japan: "jp",
	jpn: "jp",
	uk: "uk",
	unitedkingdom: "uk",
	greatbritain: "uk",
	britain: "uk",
	au: "au",
	australia: "au",
	aus: "au",
	ame: "ame",
	america: "ame",
	de: "de",
	germany: "de",
	cus: "cus",
	custom: "cus",
	cn: "cn",
	china: "cn",
	kr: "kr",
	korea: "kr",
	southkorea: "kr",
	asi: "asi",
	asia: "asi",
	br: "br",
	brazil: "br",
	sp: "sp",
	spain: "sp",
	espa: "sp",
	fr: "fr",
	france: "fr",
	gr: "gr",
	greece: "gr",
	it: "it",
	italy: "it",
	no: "no",
	norway: "no",
	dk: "dk",
	denmark: "dk",
	nz: "nz",
	newzealand: "nz",
	nl: "nl",
	netherlands: "nl",
	pl: "pl",
	poland: "pl",
	ru: "ru",
	russia: "ru",
	se: "se",
	sweden: "se",
	tw: "tw",
	taiwan: "tw",
	ca: "ca",
	canada: "ca",
	fi: "fi",
	finland: "fi",
	oce: "oce",
	oceania: "oce",
	mor: "mor",
	middleeast: "mor",
}

const LANGUAGE_INPUT_ALIASES: Record<string, string> = {
	en: "en",
	eng: "en",
	english: "en",
	de: "de",
	ger: "de",
	german: "de",
	fr: "fr",
	fre: "fr",
	french: "fr",
	es: "es",
	spa: "es",
	spanish: "es",
	it: "it",
	ita: "it",
	italian: "it",
	pt: "pt",
	por: "pt",
	portuguese: "pt",
	ja: "ja",
	jpn: "ja",
	japanese: "ja",
	nl: "nl",
	dut: "nl",
	dutch: "nl",
	sv: "sv",
	swe: "sv",
	swedish: "sv",
	no: "no",
	nor: "no",
	norwegian: "no",
	da: "da",
	danish: "da",
	fi: "fi",
	finnish: "fi",
	ru: "ru",
	russian: "ru",
	pl: "pl",
	polish: "pl",
	zh: "zh",
	chi: "zh",
	chinese: "zh",
	ko: "ko",
	kor: "ko",
	korean: "ko",
	tr: "tr",
	turkish: "tr",
	hu: "hu",
	hungarian: "hu",
	cz: "cz",
	czech: "cz",
	sk: "sk",
	slovak: "sk",
}

const PRERELEASE_PATTERNS = [
	/^beta\b/i,
	/^demo\b/i,
	/^proto\b/i,
	/^prototype\b/i,
	/^sample\b/i,
	/^preview\b/i,
	/^alpha\b/i,
	/^pre-?release\b/i,
]

const UNLICENSED_PATTERNS = [
	/^unl\b/i,
	/^unlicensed\b/i,
	/^pirate\b/i,
	/^bootleg\b/i,
]

const HACK_PATTERNS = [/^hack\b/i, /^hacked\b/i, /^romhack\b/i]
const HOMEBREW_PATTERNS = [/^homebrew\b/i, /^home\s?brew\b/i]

function normalizeKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s._-]+/g, "")
		.replace(/[^a-z0-9]/g, "")
}

function splitCommaTokens(value: string): string[] {
	const out: string[] = []
	let current = ""
	let escaped = false
	for (const ch of value) {
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
			if (current.trim()) out.push(current.trim())
			current = ""
			continue
		}
		current += ch
	}
	if (current.trim()) out.push(current.trim())
	return out
}

function stripTrailingTags(value: string): string {
	let output = value
	const trailingTag = /\s*(\([^)]*\)|\[[^\]]*\])\s*$/
	while (trailingTag.test(output)) {
		output = output.replace(trailingTag, "")
	}
	return output.trim()
}

function parseDiscInfo(token: string): DiscInfo | null {
	const trimmed = token.trim()
	const compactMatch = trimmed.match(
		/^(disc|disk|cd|gd|dvd)(\d+)(?:\s*of\s*(\d+))?$/i,
	)
	if (compactMatch) {
		const index = parseInt(compactMatch[2] ?? "", 10)
		if (Number.isFinite(index) && index > 0) {
			const totalRaw = compactMatch[3]
			const total = totalRaw ? parseInt(totalRaw, 10) : undefined
			return {
				type: compactMatch[1]!.toLowerCase() as DiscInfo["type"],
				index,
				...(Number.isFinite(total) && total ? { total } : {}),
				raw: trimmed,
			}
		}
	}

	const labeledMatch = trimmed.match(
		/^(disc|disk|cd|gd|dvd|side|part|volume|vol)\s*([0-9]+|[A-Z])(?:\s*of\s*(\d+))?$/i,
	)
	if (labeledMatch) {
		const label = labeledMatch[2] ?? ""
		const totalRaw = labeledMatch[3]
		const total = totalRaw ? parseInt(totalRaw, 10) : undefined
		let index = parseInt(label, 10)
		if (!Number.isFinite(index)) {
			const letter = label.toUpperCase()
			if (letter.length === 1 && letter >= "A" && letter <= "Z") {
				index = letter.charCodeAt(0) - 64
			}
		}
		if (Number.isFinite(index) && index > 0) {
			const type =
				labeledMatch[1]!.toLowerCase() === "vol"
					? "volume"
					: (labeledMatch[1]!.toLowerCase() as DiscInfo["type"])
			return {
				type,
				index,
				...(Number.isFinite(total) && total ? { total } : {}),
				raw: trimmed,
			}
		}
	}

	return null
}

function parseVersionInfo(token: string): VersionInfo | null {
	const trimmed = token.trim()
	const revMatch = trimmed.match(/^(?:rev|revision)\s*([0-9]+|[A-Z])$/i)
	if (revMatch) {
		const value = revMatch[1] ?? ""
		const number = parseInt(value, 10)
		if (Number.isFinite(number)) {
			return { kind: "rev", parts: [number], raw: trimmed }
		}
		const letter = value.toUpperCase()
		if (letter.length === 1 && letter >= "A" && letter <= "Z") {
			return {
				kind: "rev",
				parts: [letter.charCodeAt(0) - 64],
				letter,
				raw: trimmed,
			}
		}
	}

	const versionMatch = trimmed.match(
		/^(?:v|ver|version)\s*([0-9]+(?:\.[0-9]+)*)([A-Z])?$/i,
	)
	if (versionMatch) {
		const rawParts = (versionMatch[1] ?? "").split(".")
		const parts = rawParts
			.map(p => parseInt(p, 10))
			.filter(n => Number.isFinite(n))
		if (parts.length > 0) {
			const letter = versionMatch[2]?.toUpperCase()
			return {
				kind: "ver",
				parts: letter ? [...parts, letter.charCodeAt(0) - 64] : parts,
				...(letter ? { letter } : {}),
				raw: trimmed,
			}
		}
	}

	return null
}

function classifyTag(token: string): {
	tag: string
	flags: Partial<ParsedRomName["flags"]>
} | null {
	for (const pattern of PRERELEASE_PATTERNS) {
		if (pattern.test(token)) {
			const label = token.match(/^[A-Za-z]+/)?.[0] ?? "Beta"
			return {
				tag: label[0]!.toUpperCase() + label.slice(1),
				flags: { prerelease: true },
			}
		}
	}
	for (const pattern of UNLICENSED_PATTERNS) {
		if (pattern.test(token)) {
			const label = token.match(/^[A-Za-z]+/)?.[0] ?? "Unlicensed"
			return {
				tag: label[0]!.toUpperCase() + label.slice(1),
				flags: { unlicensed: true },
			}
		}
	}
	for (const pattern of HACK_PATTERNS) {
		if (pattern.test(token)) {
			return { tag: "Hack", flags: { hack: true } }
		}
	}
	for (const pattern of HOMEBREW_PATTERNS) {
		if (pattern.test(token)) {
			return { tag: "Homebrew", flags: { homebrew: true } }
		}
	}
	return null
}

export function normalizeRegionCode(input: string): string | null {
	const key = normalizeKey(input)
	return REGION_INPUT_ALIASES[key] ?? null
}

export function normalizeLanguageCode(input: string): string | null {
	const key = normalizeKey(input)
	return LANGUAGE_INPUT_ALIASES[key] ?? null
}

export function parseRomFilenameParts(filename: string): ParsedRomName {
	const baseName = filename.replace(/\.[^.]+$/, "")
	const title = stripTrailingTags(baseName)
	const tagGroups: string[] = []
	const tagRegex = /\(([^)]+)\)|\[([^\]]+)\]/g
	let match: RegExpExecArray | null
	while ((match = tagRegex.exec(baseName)) !== null) {
		const value = match[1] ?? match[2]
		if (value) tagGroups.push(value)
	}

	const regionCodes: string[] = []
	const regionLabels: string[] = []
	const languages: string[] = []
	const tags: string[] = []
	let version: string | undefined
	let versionInfo: VersionInfo | undefined
	let disc: DiscInfo | undefined
	const flags = {
		prerelease: false,
		unlicensed: false,
		hack: false,
		homebrew: false,
	}

	for (const group of tagGroups) {
		for (const rawToken of splitCommaTokens(group)) {
			const token = rawToken.trim()
			if (!token) continue

			if (!disc) {
				const discInfo = parseDiscInfo(token)
				if (discInfo) {
					disc = discInfo
					continue
				}
			}

			if (!versionInfo) {
				const parsedVersion = parseVersionInfo(token)
				if (parsedVersion) {
					versionInfo = parsedVersion
					version = parsedVersion.raw
					continue
				}
			}

			const languageCode = normalizeLanguageCode(token)
			if (languageCode) {
				if (!languages.includes(languageCode)) languages.push(languageCode)
				continue
			}

			const regionCode = normalizeRegionCode(token)
			if (regionCode) {
				if (!regionCodes.includes(regionCode)) regionCodes.push(regionCode)
				const label = REGION_CODE_LABELS[regionCode]
				if (label && !regionLabels.includes(label)) regionLabels.push(label)
				continue
			}

			const classified = classifyTag(token)
			if (classified) {
				if (!tags.includes(classified.tag)) tags.push(classified.tag)
				Object.assign(flags, classified.flags)
			}
		}
	}

	return {
		baseName,
		title: title || baseName,
		regions: regionLabels,
		regionCodes,
		languages,
		...(version ? { version } : {}),
		...(versionInfo ? { versionInfo } : {}),
		tags,
		flags,
		...(disc ? { disc } : {}),
	}
}
