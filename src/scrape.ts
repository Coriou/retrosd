/**
 * Artwork scraping from ScreenScraper API
 * Downloads box art, screenshots, videos for EmulationStation
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	openSync,
	readSync,
	closeSync,
	unlinkSync,
	statSync,
} from "node:fs"
import { dirname, extname, join } from "node:path"
import pLimit from "p-limit"
import { fetch as undiciFetch, Agent } from "undici"
import { downloadFile, HTTP_AGENT } from "./download.js"
import { loadMetadata } from "./metadata.js"
import { ui } from "./ui.js"
import { log } from "./logger.js"

/**
 * Conservative agent for ScreenScraper to avoid rate limiting
 */
const SCREENSCRAPER_AGENT = new Agent({
	keepAliveTimeout: 30_000,
	connections: 8, // Limit concurrent connections
	pipelining: 0, // Disable pipelining
})

/**
 * Lane-based rate limiter for proper multi-threaded API access
 * Each "lane" (thread) enforces its own minimum delay between requests
 * This allows N threads to each make requests at the rate limit
 */
class LaneRateLimiter {
	private laneNextAt: number[]
	private rr = 0

	constructor(
		private readonly lanes: number,
		private readonly minDelayMs: number,
	) {
		this.laneNextAt = Array.from({ length: lanes }, () => 0)
	}

	async wait(): Promise<void> {
		const lane = this.rr++ % this.lanes
		const now = Date.now()
		const nextAt = this.laneNextAt[lane] ?? 0
		const waitMs = Math.max(0, nextAt - now)
		if (waitMs > 0) {
			await new Promise(resolve => setTimeout(resolve, waitMs))
		}
		this.laneNextAt[lane] = Date.now() + this.minDelayMs
	}
}

/**
 * Dev credentials for ScreenScraper API
 * Provide via environment variables or CLI options.
 */
const ENV_DEV_ID = process.env["SCREENSCRAPER_DEV_ID"] ?? ""
const ENV_DEV_PASSWORD = process.env["SCREENSCRAPER_DEV_PASSWORD"] ?? ""

/**
 * Cache entry for a scraped game
 */
interface GameCacheEntry {
	id: string
	name: string
	region: string
	media: {
		boxFront?: { url: string; format: string }
		boxBack?: { url: string; format: string }
		screenshot?: { url: string; format: string }
		video?: { url: string; format: string }
	}
	timestamp: number
}

/**
 * Simple file-based cache for game lookups
 */
class GameCache {
	private cache = new Map<string, GameCacheEntry>()
	private cacheFile: string
	private dirty = false
	private pendingWrites = 0
	private lastSaveAt = 0

	constructor(cacheFile: string) {
		this.cacheFile = cacheFile
		this.load()
	}

	private load(): void {
		try {
			if (existsSync(this.cacheFile)) {
				const data = JSON.parse(readFileSync(this.cacheFile, "utf-8"))
				this.cache = new Map(Object.entries(data))
			}
		} catch {
			// Ignore cache load errors
		}
	}

	private save(): void {
		try {
			const data = Object.fromEntries(this.cache)
			writeFileSync(this.cacheFile, JSON.stringify(data, null, 2), "utf-8")
			this.dirty = false
			this.pendingWrites = 0
			this.lastSaveAt = Date.now()
		} catch {
			// Ignore cache save errors
		}
	}

	private maybeSave(): void {
		if (!this.dirty) {
			return
		}

		const now = Date.now()
		if (this.pendingWrites >= 25 || now - this.lastSaveAt >= 5000) {
			this.save()
		}
	}

	get(key: string): GameCacheEntry | undefined {
		return this.cache.get(key)
	}

	set(key: string, entry: GameCacheEntry): void {
		if (!key) {
			return
		}
		this.cache.set(key, entry)
		this.dirty = true
		this.pendingWrites++
		this.maybeSave()
	}

	flush(): void {
		if (this.dirty) {
			this.save()
		}
	}

	static makeKey(
		systemId: number,
		sha1?: string,
		crc32?: string,
		romName?: string,
		size?: number,
	): string {
		if (sha1) return `${systemId}:sha1:${sha1}`
		if (crc32) return `${systemId}:crc32:${crc32}`
		if (romName) {
			const normalized = romName.toLowerCase().replace(/\s+/g, " ").trim()
			const sizeSuffix = size ? `:${size}` : ""
			return `${systemId}:name:${normalized}${sizeSuffix}`
		}
		return ""
	}
}

/**
 * ScreenScraper system IDs
 */
const SCREENSCRAPER_SYSTEMS: Record<string, number> = {
	FC: 3, // NES
	GB: 9, // Game Boy
	GBA: 12, // Game Boy Advance
	GBC: 10, // Game Boy Color
	MD: 1, // Genesis/Mega Drive
	PCE: 31, // PC Engine
	PS: 57, // PlayStation
	SGB: 127, // Super Game Boy
}

const DEV_CREDENTIAL_ERROR_PATTERNS = [
	/identifiants d[eé]veloppeur/i,
	/developer credentials?/i,
	/\bdevid\b/i,
]

function resolveDevCredentials(options?: {
	devId?: string | undefined
	devPassword?: string | undefined
}): { devId?: string; devPassword?: string } {
	const devId = (options?.devId ?? ENV_DEV_ID).trim()
	const devPassword = (options?.devPassword ?? ENV_DEV_PASSWORD).trim()
	if (!devId || !devPassword) {
		return {}
	}
	return { devId, devPassword }
}

function isDevCredentialError(message: string): boolean {
	return DEV_CREDENTIAL_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

function normalizeScreenScraperError(message: string): string {
	const trimmed = message.trim()
	if (!trimmed) {
		return "Unknown ScreenScraper error"
	}
	if (isDevCredentialError(trimmed)) {
		return "ScreenScraper developer credentials required. Set SCREENSCRAPER_DEV_ID/SCREENSCRAPER_DEV_PASSWORD or pass --dev-id/--dev-password."
	}
	return trimmed
}

const ROM_EXTENSIONS_BY_SYSTEM: Record<string, string[]> = {
	FC: [".nes", ".fds"],
	GB: [".gb"],
	GBA: [".gba"],
	GBC: [".gbc"],
	MD: [".md", ".bin", ".gen", ".smd"],
	PCE: [".pce"],
	PS: [".bin", ".cue", ".chd", ".pbp", ".iso", ".img", ".ccd", ".mdf", ".mds"],
	SGB: [".gb", ".gbc"],
}

const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar"])
const EXTRA_ROM_EXTENSIONS = new Set([".m3u"])
const NON_ROM_EXTENSIONS = new Set([".json", ".xml", ".txt", ".nfo", ".dat"])

/**
 * Determine ROM type for ScreenScraper API
 */
function guessRomType(system: string, filename: string): "rom" | "iso" {
	const ext = extname(filename).toLowerCase()
	// Disc-based systems or disc formats
	if (system === "PS") return "iso"
	if (
		[
			".iso",
			".cue",
			".chd",
			".pbp",
			".ccd",
			".mdf",
			".mds",
			".img",
			".bin",
		].includes(ext)
	) {
		return "iso"
	}
	return "rom"
}

function isRomFilename(
	filename: string,
	system: string,
	includeUnknown: boolean,
): boolean {
	if (filename.startsWith(".") || filename === "media") {
		return false
	}

	const ext = extname(filename).toLowerCase()
	if (!ext) {
		return false
	}
	if (NON_ROM_EXTENSIONS.has(ext)) {
		return false
	}

	const allowed = ROM_EXTENSIONS_BY_SYSTEM[system]
	if (!allowed) {
		return true
	}

	if (
		allowed.includes(ext) ||
		ARCHIVE_EXTENSIONS.has(ext) ||
		EXTRA_ROM_EXTENSIONS.has(ext)
	) {
		return true
	}

	return includeUnknown
}

/**
 * Validate ScreenScraper credentials
 */
export async function validateCredentials(
	username?: string,
	password?: string,
	devId?: string,
	devPassword?: string,
): Promise<{ valid: boolean; error?: string; maxThreads?: number }> {
	const baseUrl = "https://api.screenscraper.fr/api2"
	const params = new URLSearchParams({
		softname: "retrosd",
		output: "json",
		ssid: username || "",
		sspassword: password || "",
	})

	const devCreds = resolveDevCredentials({ devId, devPassword })
	if (devCreds.devId && devCreds.devPassword) {
		params.set("devid", devCreds.devId)
		params.set("devpassword", devCreds.devPassword)
	}

	try {
		const response = await undiciFetch(
			`${baseUrl}/ssuserInfos.php?${params.toString()}`,
			{
				headers: { "User-Agent": "RetroSD/2.0.0" },
				dispatcher: HTTP_AGENT,
			},
		)

		if (!response.ok) {
			return {
				valid: false,
				error: `HTTP ${response.status}: ${response.statusText}`,
			}
		}

		const raw = await response.text()
		let data: any
		try {
			data = JSON.parse(raw)
		} catch {
			return {
				valid: false,
				error: normalizeScreenScraperError(raw),
			}
		}

		// Check for authentication error
		if (data.response?.error) {
			const errorMsg = data.response.error
			if (errorMsg.includes("Erreur d'identification")) {
				return {
					valid: false,
					error: "Invalid username or password",
				}
			}
			return { valid: false, error: normalizeScreenScraperError(errorMsg) }
		}

		const userInfo = data.response?.ssuser
		if (!userInfo) {
			return { valid: true, maxThreads: 1 } // Anonymous
		}

		// Return thread limit based on account level
		const maxThreads = userInfo.maxthreads || userInfo.maxdownloadspeed || 1
		return { valid: true, maxThreads }
	} catch (err) {
		return {
			valid: false,
			error: err instanceof Error ? err.message : "Network error",
		}
	}
}

/**
 * Media types to download
 */
export interface ScrapeOptions {
	boxArt?: boolean
	screenshot?: boolean
	video?: boolean
	username?: string
	password?: string
	devId?: string
	devPassword?: string
	verbose?: boolean
	quiet?: boolean
	concurrency?: number
	downloadConcurrency?: number
	overwrite?: boolean
	includeUnknown?: boolean
}

interface ScreenScraperGame {
	id: string
	name: string
	region: string
	media: {
		boxFront?: { url: string; format: string }
		boxBack?: { url: string; format: string }
		screenshot?: { url: string; format: string }
		video?: { url: string; format: string }
	}
}

function isRetryableApiError(message: string): boolean {
	return /limit|trop|maximum|busy|overload|timeout|tempor/i.test(message)
}

/**
 * Search ScreenScraper for a game
 */
async function searchScreenScraper(
	systemId: number,
	romFilename: string,
	system: string,
	romSize: number,
	options: {
		username?: string
		password?: string
		devId?: string
		devPassword?: string
		crc32?: string
		sha1?: string
		verbose?: boolean
	},
	apiLimiter: LaneRateLimiter,
): Promise<{ game?: ScreenScraperGame; error?: string }> {
	const baseUrl = "https://api.screenscraper.fr/api2"

	// Build query params - use full filename with extension for better matching
	const params = new URLSearchParams({
		softname: "retrosd/2.0.0",
		output: "json",
		systemeid: systemId.toString(),
		romnom: romFilename,
		romtaille: romSize.toString(),
		romtype: guessRomType(system, romFilename),
	})

	// Add dev credentials if available
	const devCreds = resolveDevCredentials({
		devId: options.devId,
		devPassword: options.devPassword,
	})
	if (devCreds.devId && devCreds.devPassword) {
		params.set("devid", devCreds.devId)
		params.set("devpassword", devCreds.devPassword)
	}

	// Add user credentials if provided
	if (options.username && options.password) {
		params.set("ssid", options.username)
		params.set("sspassword", options.password)
	}

	// Use hashes for better matching if available
	if (options.crc32) {
		params.set("crc", options.crc32)
	}
	if (options.sha1) {
		params.set("sha1", options.sha1)
	}

	const maxAttempts = 3
	const baseRetryDelayMs = 1200

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		// Rate limit API lookups only (not media downloads)
		await apiLimiter.wait()

		try {
			const response = await undiciFetch(
				`${baseUrl}/jeuInfos.php?${params.toString()}`,
				{
					headers: {
						"User-Agent": "RetroSD/2.0.0",
					},
					dispatcher: HTTP_AGENT,
				},
			)

			const raw = await response.text()
			const maybeRetryable = response.status === 429 || response.status >= 500

			if (!response.ok) {
				if (maybeRetryable && attempt < maxAttempts) {
					await sleep(baseRetryDelayMs * attempt)
					continue
				}
				log.scrape.warn(
					{ status: response.status, romFilename },
					"ScreenScraper HTTP error",
				)
				return { error: normalizeScreenScraperError(raw) }
			}

			let data: any
			try {
				data = JSON.parse(raw)
			} catch {
				log.scrape.warn(
					{ romFilename, raw: raw.slice(0, 200) },
					"ScreenScraper invalid JSON",
				)
				return { error: normalizeScreenScraperError(raw) }
			}

			// Check for errors
			if (data.response?.error) {
				const errorMessage = normalizeScreenScraperError(
					String(data.response.error),
				)
				if (isRetryableApiError(errorMessage) && attempt < maxAttempts) {
					await sleep(baseRetryDelayMs * attempt)
					continue
				}
				log.scrape.warn(
					{ romFilename, apiError: data.response.error },
					"ScreenScraper API error",
				)
				return { error: errorMessage }
			}

			const game = data.response?.jeu
			if (!game) {
				log.scrape.debug({ romFilename }, "game not found on ScreenScraper")
				return { error: "Game not found on ScreenScraper" }
			}

			// Extract media URLs
			const media: ScreenScraperGame["media"] = {}

			if (game.medias) {
				for (const m of game.medias) {
					// Box art - prefer world region, fallback to any
					if (m.type === "box-2D") {
						if (!media.boxFront || m.region === "wor" || m.region === "us") {
							media.boxFront = { url: m.url, format: m.format }
						}
					} else if (m.type === "box-2D-back") {
						if (!media.boxBack || m.region === "wor" || m.region === "us") {
							media.boxBack = { url: m.url, format: m.format }
						}
					} else if (m.type === "ss" || m.type === "ss-game") {
						if (!media.screenshot || m.region === "wor" || m.region === "us") {
							media.screenshot = { url: m.url, format: m.format }
						}
					} else if (m.type === "video" || m.type === "video-normalized") {
						if (!media.video) {
							media.video = { url: m.url, format: m.format }
						}
					}
				}
			}

			return {
				game: {
					id: game.id?.toString() || "",
					name: game.noms?.[0]?.text || romFilename,
					region: game.region || "wor",
					media,
				},
			}
		} catch (err) {
			if (attempt >= maxAttempts) {
				return {
					error: err instanceof Error ? err.message : String(err),
				}
			}
			await sleep(baseRetryDelayMs * attempt)
		}
	}

	return { error: "ScreenScraper request failed" }
}

/**
 * Validate downloaded media file to ensure it's not an error page
 */
async function validateMediaFile(filePath: string): Promise<boolean> {
	try {
		// Check minimum file size (error pages are usually small)
		const stats = statSync(filePath)
		if (stats.size < 1024) {
			// Less than 1KB is suspicious for media
			unlinkSync(filePath)
			return false
		}

		// Check magic bytes to detect HTML/JSON error responses
		// Read only first 512 bytes
		const fd = openSync(filePath, "r")
		const buffer = Buffer.alloc(512)
		const bytesRead = readSync(fd, buffer, 0, 512, 0)
		closeSync(fd)

		const start = buffer.subarray(0, bytesRead).toString("utf-8")

		// Detect HTML error pages
		if (
			start.includes("<!DOCTYPE") ||
			start.includes("<html") ||
			start.includes("<HTML")
		) {
			unlinkSync(filePath) // Delete HTML error file
			return false
		}

		// Detect JSON error responses
		if (start.trim().startsWith("{") && start.includes('"error"')) {
			unlinkSync(filePath) // Delete JSON error file
			return false
		}

		// Check for valid image magic bytes
		const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50
		const isJPEG = buffer[0] === 0xff && buffer[1] === 0xd8
		const isGIF = buffer[0] === 0x47 && buffer[1] === 0x49
		const isMP4 =
			buffer.subarray(4, 8).toString() === "ftyp" ||
			buffer.subarray(4, 12).toString() === "ftypmp42"

		if (isPNG || isJPEG || isGIF || isMP4) {
			return true
		}

		// If we can't identify the format, be conservative and keep it
		// (might be a valid but unusual format)
		return true
	} catch {
		return false
	}
}

/**
 * Download media file with retries and validation
 */
async function downloadMedia(
	url: string,
	destPath: string,
	verbose?: boolean,
): Promise<boolean> {
	const maxRetries = 3
	const baseRetryDelayMs = 2000

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			// Download using existing function with ScreenScraper specific settings
			const result = await downloadFile(url, destPath, {
				retries: 1,
				delay: 1,
				quiet: true,
				verbose: false,
				headers: { "User-Agent": "RetroSD/2.0.0" },
				agent: SCREENSCRAPER_AGENT,
			})

			if (result.success) {
				// Check for skipped (304) or already exists
				if (result.skipped) {
					return true
				}

				// Validate content-type if available
				if (result.contentType) {
					if (
						result.contentType.includes("text/html") ||
						result.contentType.includes("application/json")
					) {
						log.scrape.debug(
							{ contentType: result.contentType, url },
							"invalid content-type",
						)
						unlinkSync(destPath)
						await sleep(baseRetryDelayMs * (attempt + 1))
						continue
					}
				}

				// Validate the downloaded file
				const isValid = await validateMediaFile(destPath)
				if (!isValid) {
					log.scrape.debug({ destPath }, "invalid file content, retrying")
					await sleep(baseRetryDelayMs * (attempt + 1))
					continue
				}

				log.scrape.debug({ destPath }, "download complete")
				return true
			} else if (result.statusCode === 404) {
				// Not found, don't retry
				log.scrape.debug({ url }, "404 not found")
				return false
			} else {
				// Other error
				log.scrape.debug(
					{ error: result.error, statusCode: result.statusCode },
					"download error, retrying",
				)
			}
		} catch (err) {
			log.scrape.warn(
				{ url, error: err instanceof Error ? err.message : String(err) },
				"download failed",
			)
			if (attempt < maxRetries - 1) {
				await sleep(baseRetryDelayMs * (attempt + 1))
			}
		}
	}

	return false
}

type DownloadScheduler = <T>(fn: () => Promise<T>) => Promise<T>

interface LookupSuccess {
	ok: true
	baseName: string
	romDir: string
	game: ScreenScraperGame
	systemId: number
}

interface LookupFailure {
	ok: false
	error: string
}

type LookupResult = LookupSuccess | LookupFailure

interface MediaDownloadResult {
	media: {
		boxArt?: string
		screenshot?: string
		video?: string
	}
	hadAny: boolean
	downloadedAny: boolean
}

async function lookupGameForRom(
	romPath: string,
	romFilename: string,
	system: string,
	options: ScrapeOptions,
	apiLimiter: LaneRateLimiter,
	cache: GameCache,
): Promise<LookupResult> {
	const systemId = SCREENSCRAPER_SYSTEMS[system]
	if (!systemId) {
		return {
			ok: false,
			error: `System ${system} not supported by ScreenScraper`,
		}
	}

	const romDir = dirname(romPath)
	const metadata = loadMetadata(romDir, romFilename)
	const baseName = romFilename.replace(/\.[^.]+$/, "")

	const searchOptions: {
		username?: string
		password?: string
		devId?: string
		devPassword?: string
		crc32?: string
		sha1?: string
		verbose?: boolean
	} = {}

	if (options.username) searchOptions.username = options.username
	if (options.password) searchOptions.password = options.password
	if (options.devId) searchOptions.devId = options.devId
	if (options.devPassword) searchOptions.devPassword = options.devPassword
	if (metadata?.hash?.crc32) searchOptions.crc32 = metadata.hash.crc32
	if (metadata?.hash?.sha1) searchOptions.sha1 = metadata.hash.sha1
	if (options.verbose !== undefined) {
		searchOptions.verbose = options.verbose
	}

	const cacheKey = GameCache.makeKey(
		systemId,
		metadata?.hash?.sha1,
		metadata?.hash?.crc32,
		baseName,
		metadata?.hash?.size,
	)

	let game = cacheKey ? cache.get(cacheKey) : undefined

	if (!game) {
		// Get file size for API lookup
		const { statSync } = await import("node:fs")
		const romSize = metadata?.hash?.size ?? statSync(romPath).size

		const result = await searchScreenScraper(
			systemId,
			romFilename,
			system,
			romSize,
			searchOptions,
			apiLimiter,
		)

		if (!result.game) {
			return {
				ok: false,
				error: result.error || "Game not found on ScreenScraper",
			}
		}

		game = {
			...result.game,
			timestamp: Date.now(),
		}

		if (cacheKey) {
			cache.set(cacheKey, game)
		}
	}

	return {
		ok: true,
		baseName,
		romDir,
		game,
		systemId,
	}
}

async function ensureMediaFile(
	url: string,
	destPath: string,
	overwrite: boolean,
	verbose?: boolean,
): Promise<{ ok: boolean; downloaded: boolean }> {
	const hadExisting = existsSync(destPath)
	if (!overwrite && hadExisting) {
		if (verbose) {
			console.log(`[Skip] Using existing: ${destPath}`)
		}
		return { ok: true, downloaded: false }
	}

	const ok = await downloadMedia(url, destPath, verbose)
	if (ok) {
		return { ok: true, downloaded: true }
	}

	if (hadExisting) {
		log.scrape.debug({ destPath }, "download failed, using existing file")
		return { ok: true, downloaded: false }
	}

	return { ok: false, downloaded: false }
}

async function downloadMediaForGame(
	game: ScreenScraperGame,
	baseName: string,
	mediaDir: string,
	options: ScrapeOptions,
	schedule?: DownloadScheduler,
): Promise<MediaDownloadResult> {
	const run: DownloadScheduler = schedule ?? (fn => fn())
	const wantsBox = options.boxArt !== false
	const wantsSS = options.screenshot === true
	const wantsVideo = options.video === true
	const overwrite = options.overwrite === true
	const verbose = options.verbose === true

	const mediaResult: MediaDownloadResult = {
		media: {},
		hadAny: false,
		downloadedAny: false,
	}

	if (!wantsBox && !wantsSS && !wantsVideo) {
		return mediaResult
	}

	mkdirSync(mediaDir, { recursive: true })

	const downloadTasks: Array<Promise<void>> = []

	if (wantsBox && game.media.boxFront) {
		const format = game.media.boxFront.format || "png"
		const ext = format.startsWith(".") ? format : `.${format}`
		const boxPath = join(mediaDir, `${baseName}-box${ext}`)
		const url = game.media.boxFront.url

		downloadTasks.push(
			run(async () => {
				const result = await ensureMediaFile(url, boxPath, overwrite, verbose)
				if (result.ok) {
					mediaResult.media.boxArt = boxPath
					mediaResult.hadAny = true
					if (result.downloaded) {
						mediaResult.downloadedAny = true
					}
				}
			}),
		)
	} else if (wantsBox) {
		// Check for existing media with any extension
		const possibleExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
		for (const ext of possibleExts) {
			const boxPath = join(mediaDir, `${baseName}-box${ext}`)
			if (existsSync(boxPath)) {
				mediaResult.media.boxArt = boxPath
				mediaResult.hadAny = true
				break
			}
		}
	}

	if (wantsSS && game.media.screenshot) {
		const format = game.media.screenshot.format || "png"
		const ext = format.startsWith(".") ? format : `.${format}`
		const ssPath = join(mediaDir, `${baseName}-screenshot${ext}`)
		const url = game.media.screenshot.url

		downloadTasks.push(
			run(async () => {
				const result = await ensureMediaFile(url, ssPath, overwrite, verbose)
				if (result.ok) {
					mediaResult.media.screenshot = ssPath
					mediaResult.hadAny = true
					if (result.downloaded) {
						mediaResult.downloadedAny = true
					}
				}
			}),
		)
	} else if (wantsSS) {
		// Check for existing media with any extension
		const possibleExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
		for (const ext of possibleExts) {
			const ssPath = join(mediaDir, `${baseName}-screenshot${ext}`)
			if (existsSync(ssPath)) {
				mediaResult.media.screenshot = ssPath
				mediaResult.hadAny = true
				break
			}
		}
	}

	if (wantsVideo && game.media.video) {
		const format = game.media.video.format || "mp4"
		const ext = format.startsWith(".") ? format : `.${format}`
		const videoPath = join(mediaDir, `${baseName}-video${ext}`)
		const url = game.media.video.url

		downloadTasks.push(
			run(async () => {
				const result = await ensureMediaFile(url, videoPath, overwrite, verbose)
				if (result.ok) {
					mediaResult.media.video = videoPath
					mediaResult.hadAny = true
					if (result.downloaded) {
						mediaResult.downloadedAny = true
					}
				}
			}),
		)
	} else if (wantsVideo) {
		// Check for existing media with any extension
		const possibleExts = [".mp4", ".webm"]
		for (const ext of possibleExts) {
			const videoPath = join(mediaDir, `${baseName}-video${ext}`)
			if (existsSync(videoPath)) {
				mediaResult.media.video = videoPath
				mediaResult.hadAny = true
				break
			}
		}
	}

	await Promise.all(downloadTasks)
	return mediaResult
}

/**
 * Scrape artwork for a single ROM
 */
export async function scrapeRom(
	romPath: string,
	romFilename: string,
	system: string,
	mediaDir: string,
	options: ScrapeOptions,
	apiLimiter: LaneRateLimiter,
	cache: GameCache,
): Promise<{
	success: boolean
	boxArt?: string
	screenshot?: string
	video?: string
	error?: string
}> {
	const lookup = await lookupGameForRom(
		romPath,
		romFilename,
		system,
		options,
		apiLimiter,
		cache,
	)

	if (!lookup.ok) {
		return {
			success: false,
			error: lookup.error,
		}
	}

	const media = await downloadMediaForGame(
		lookup.game,
		lookup.baseName,
		mediaDir,
		options,
	)

	cache.flush()

	const wantsAny =
		options.boxArt !== false ||
		options.screenshot === true ||
		options.video === true

	if (wantsAny && !media.hadAny) {
		return {
			success: false,
			error: "No requested media available",
		}
	}

	return {
		success: true,
		...media.media,
	}
}

/**
 * Scrape artwork for an entire system
 */
export async function scrapeSystem(
	systemDir: string,
	system: string,
	options: ScrapeOptions,
): Promise<{
	total: number
	success: number
	failed: number
	skipped: number
}> {
	const { readdirSync } = await import("node:fs")
	type SpinnerLike = {
		text: string
		stop: () => void
		start: () => void
		succeed: (text: string) => void
	}

	const mediaDir = join(systemDir, "media")
	const files = readdirSync(systemDir)

	const includeUnknown = options.includeUnknown === true
	const romFiles = files.filter(filename =>
		isRomFilename(filename, system, includeUnknown),
	)

	const total = romFiles.length
	let success = 0
	let failed = 0
	let skipped = 0
	let devCredentialError: string | null = null

	let spinner: SpinnerLike | null = null
	if (!options.quiet) {
		spinner = {
			text: "",
			stop: () => {},
			start: () => {},
			succeed: (text: string) => {
				ui.success(text)
			},
		}
	}

	// Initialize cache
	const cacheFile = join(systemDir, ".screenscraper-cache.json")
	const cache = new GameCache(cacheFile)

	// Check for dev credentials
	const devCreds = resolveDevCredentials({
		devId: options.devId,
		devPassword: options.devPassword,
	})

	if (!devCreds.devId || !devCreds.devPassword) {
		const error =
			"ScreenScraper developer credentials required. Set SCREENSCRAPER_DEV_ID/SCREENSCRAPER_DEV_PASSWORD or pass --dev-id/--dev-password."
		if (!options.quiet) {
			if (spinner) spinner.stop()
			ui.error(error)
		}
		return { total, success: 0, failed: total, skipped: 0 }
	}

	// Create lane-based rate limiter for API lookups
	// Each lane can make requests at the specified rate
	const lanes = Math.max(1, Math.floor(options.concurrency ?? 1))
	const apiLimiter = new LaneRateLimiter(lanes, 1200) // 1.2s per thread (Skyscraper standard)

	// Cap download concurrency to thread limit to avoid exceeding ScreenScraper limits
	const downloadConcurrency = Math.max(
		1,
		Math.min(lanes, Math.floor(options.downloadConcurrency ?? lanes)),
	)
	const lookupLimit = pLimit(lanes)
	const downloadLimit = pLimit(downloadConcurrency)

	const wantsBox = options.boxArt !== false
	const wantsSS = options.screenshot === true
	const wantsVideo = options.video === true
	const wantsAny = wantsBox || wantsSS || wantsVideo

	// Pre-filter ROMs to skip those with existing media (avoids API calls)
	const romsToScrape: string[] = []

	for (const filename of romFiles) {
		if (!filename) continue

		// Only skip if NOT overwriting and ALL requested media exists
		if (!options.overwrite && wantsAny) {
			const baseName = filename.replace(/\.[^.]+$/, "")
			const boxExists =
				wantsBox && existsSync(join(mediaDir, `${baseName}-box.png`))
			const ssExists =
				wantsSS && existsSync(join(mediaDir, `${baseName}-screenshot.png`))
			const videoExists =
				wantsVideo && existsSync(join(mediaDir, `${baseName}-video.mp4`))

			const hasAllRequestedMedia =
				(!wantsBox || boxExists) &&
				(!wantsSS || ssExists) &&
				(!wantsVideo || videoExists)

			if (hasAllRequestedMedia) {
				skipped++
				continue
			}
		}

		romsToScrape.push(filename)
	}

	if (!options.quiet && spinner) {
		spinner.text = `Scraping ${system}: ${romsToScrape.length} to scrape, ${skipped} skipped (already have media)`
	}

	const updateSpinner = (filename?: string): void => {
		if (!spinner) return
		const processed = success + failed + skipped
		const percentage = total > 0 ? Math.round((processed / total) * 100) : 100
		const label = filename
			? ` (${filename.substring(0, 40)}${filename.length > 40 ? "..." : ""})`
			: ""
		spinner.text = `[${percentage}%] Scraping ${system}: ${processed}/${total}${label}`
	}

	const downloadJobs: Array<Promise<void>> = []

	const tasks = romsToScrape.map(filename =>
		lookupLimit(async () => {
			if (devCredentialError) {
				skipped++
				updateSpinner(filename)
				return
			}
			const romPath = join(systemDir, filename)

			const lookup = await lookupGameForRom(
				romPath,
				filename,
				system,
				options,
				apiLimiter,
				cache,
			)

			if (!lookup.ok) {
				if (lookup.error && isDevCredentialError(lookup.error)) {
					devCredentialError = lookup.error
				}
				failed++
				updateSpinner(filename)
				if (options.verbose && !options.quiet) {
					if (spinner) spinner.stop()
					ui.debug(`Failed to scrape ${filename}: ${lookup.error}`, true)
					if (spinner) spinner.start()
				}
				return
			}

			// Schedule download job to run after lookup completes
			const downloadJob = (async () => {
				try {
					const media = await downloadMediaForGame(
						lookup.game,
						lookup.baseName,
						mediaDir,
						options,
						downloadLimit,
					)

					const ok = !wantsAny || media.hadAny
					if (ok) {
						if (media.downloadedAny) {
							success++
						} else {
							skipped++
						}
					} else {
						failed++
					}
					updateSpinner(filename)

					if (!ok && options.verbose && !options.quiet) {
						if (spinner) spinner.stop()
						ui.debug(
							`Failed to scrape ${filename}: No requested media available`,
							true,
						)
						if (spinner) spinner.start()
					}
				} catch (err) {
					failed++
					updateSpinner(filename)
					if (options.verbose && !options.quiet) {
						if (spinner) spinner.stop()
						ui.debug(
							`Failed to scrape ${filename}: ${
								err instanceof Error ? err.message : String(err)
							}`,
							true,
						)
						if (spinner) spinner.start()
					}
				}
			})()

			downloadJobs.push(downloadJob)
		}),
	)

	// Wait for all lookups to complete
	await Promise.all(tasks)
	// Then wait for all downloads to finish
	await Promise.all(downloadJobs)
	cache.flush()

	if (devCredentialError && !options.quiet) {
		if (spinner) spinner.stop()
		ui.warn(devCredentialError)
		if (spinner) spinner.start()
	}

	if (spinner) {
		spinner.succeed(
			`${system}: ${success} scraped, ${skipped} skipped, ${failed} failed`,
		)
	}

	return { total, success, failed, skipped }
}

/**
 * Generate EmulationStation gamelist.xml
 */
export function generateGamelist(systemDir: string, system: string): string {
	const files = readdirSync(systemDir)
	const mediaDir = join(systemDir, "media")

	const lines: string[] = []
	lines.push('<?xml version="1.0"?>')
	lines.push("<gameList>")

	for (const filename of files) {
		if (!isRomFilename(filename, system, true)) {
			continue
		}

		const baseName = filename.replace(/\.[^.]+$/, "")
		const metadata = loadMetadata(systemDir, filename)

		// Find actual media files (they may have different extensions)
		const possibleImageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
		const possibleVideoExts = [".mp4", ".webm"]

		let boxPath: string | undefined
		let ssPath: string | undefined
		let videoPath: string | undefined

		for (const ext of possibleImageExts) {
			const path = join(mediaDir, `${baseName}-box${ext}`)
			if (existsSync(path)) {
				boxPath = path
				break
			}
		}

		for (const ext of possibleImageExts) {
			const path = join(mediaDir, `${baseName}-screenshot${ext}`)
			if (existsSync(path)) {
				ssPath = path
				break
			}
		}

		for (const ext of possibleVideoExts) {
			const path = join(mediaDir, `${baseName}-video${ext}`)
			if (existsSync(path)) {
				videoPath = path
				break
			}
		}

		lines.push("\t<game>")
		lines.push(`\t\t<path>./${filename}</path>`)

		if (metadata) {
			lines.push(`\t\t<name>${escapeXml(metadata.title)}</name>`)
			if (metadata.region.length > 0) {
				lines.push(
					`\t\t<region>${escapeXml(metadata.region.join(", "))}</region>`,
				)
			}
		} else {
			lines.push(`\t\t<name>${escapeXml(baseName)}</name>`)
		}

		if (boxPath) {
			const filename = boxPath.split("/").pop()
			lines.push(`\t\t<image>./media/${filename}</image>`)
		}
		if (ssPath) {
			const filename = ssPath.split("/").pop()
			lines.push(`\t\t<thumbnail>./media/${filename}</thumbnail>`)
		}
		if (videoPath) {
			const filename = videoPath.split("/").pop()
			lines.push(`\t\t<video>./media/${filename}</video>`)
		}

		lines.push("\t</game>")
	}

	lines.push("</gameList>")
	return lines.join("\n")
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
