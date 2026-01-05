/**
 * Media download and validation utilities
 *
 * Handles downloading media files from ScreenScraper with:
 * - Magic byte validation to detect error pages
 * - Retry with exponential backoff
 * - Existing file checking
 */

import {
	existsSync,
	statSync,
	unlinkSync,
	openSync,
	readSync,
	closeSync,
	mkdirSync,
} from "node:fs"
import { join } from "node:path"
import { Agent } from "undici"
import { downloadFile } from "../../download.js"
import { log } from "../../logger.js"
import type { ScreenScraperGame, MediaDownloadResult } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Agent for ScreenScraper (separate from main agent)
// ─────────────────────────────────────────────────────────────────────────────

const SCREENSCRAPER_AGENT = new Agent({
	keepAliveTimeout: 30_000,
	keepAliveMaxTimeout: 60_000,
	pipelining: 0, // Disable pipelining
})

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate downloaded media file to ensure it's not an error page
 */
export async function validateMediaFile(filePath: string): Promise<boolean> {
	try {
		// Check minimum file size (error pages are usually small)
		const stats = statSync(filePath)
		if (stats.size < 1024) {
			unlinkSync(filePath)
			return false
		}

		// Check magic bytes to detect HTML/JSON error responses
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
			unlinkSync(filePath)
			return false
		}

		// Detect JSON error responses
		if (start.trim().startsWith("{") && start.includes('"error"')) {
			unlinkSync(filePath)
			return false
		}

		// Check for valid image/video magic bytes
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
		return true
	} catch {
		return false
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Download Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download media file with retries and validation
 */
export async function downloadMedia(
	url: string,
	destPath: string,
	_verbose?: boolean,
): Promise<{ ok: boolean; error?: string }> {
	const maxRetries = 3
	const baseRetryDelayMs = 2000

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const result = await downloadFile(url, destPath, {
				retries: 1,
				delay: 1,
				quiet: true,
				verbose: false,
				headers: { "User-Agent": "RetroSD/2.0.0" },
				agent: SCREENSCRAPER_AGENT,
			})

			if (result.success) {
				if (result.skipped) {
					return { ok: true }
				}

				// Validate content-type
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
				return { ok: true }
			} else if (result.statusCode === 404) {
				log.scrape.debug({ url }, "404 not found")
				return { ok: false, error: "Not found (404)" }
			} else {
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

	return { ok: false, error: "Download failed" }
}

/**
 * Ensure a media file exists, downloading if needed
 */
export async function ensureMediaFile(
	url: string,
	destPath: string,
	overwrite: boolean,
	verbose?: boolean,
): Promise<{ ok: boolean; downloaded: boolean; error?: string }> {
	const hadExisting = existsSync(destPath)
	if (!overwrite && hadExisting) {
		if (verbose) {
			log.scrape.debug({ destPath }, "skipping existing file")
		}
		return { ok: true, downloaded: false }
	}

	const result = await downloadMedia(url, destPath, verbose)
	if (result.ok) {
		return { ok: true, downloaded: true }
	}

	if (hadExisting) {
		log.scrape.debug({ destPath }, "download failed, using existing file")
		return { ok: true, downloaded: false }
	}

	return {
		ok: false,
		downloaded: false,
		...(result.error ? { error: result.error } : {}),
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Media Download Orchestration
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaDownloadOptions {
	boxArt?: boolean | undefined
	screenshot?: boolean | undefined
	video?: boolean | undefined
	overwrite?: boolean | undefined
	verbose?: boolean | undefined
	username?: string | undefined
	password?: string | undefined
	devId?: string | undefined
	devPassword?: string | undefined
}

function normalizeScreenScraperMediaUrl(
	url: string,
	creds: {
		username?: string | undefined
		password?: string | undefined
		devId?: string | undefined
		devPassword?: string | undefined
	},
): string {
	const trimmed = url.trim()
	if (!trimmed) return url

	// Some responses can be protocol-relative or relative.
	const absolute = trimmed.startsWith("//")
		? `https:${trimmed}`
		: trimmed.startsWith("/")
			? `https://www.screenscraper.fr${trimmed}`
			: trimmed

	let parsed: URL
	try {
		parsed = new URL(absolute)
	} catch {
		return url
	}

	const isPlaceholder = (value: string | null): boolean => {
		if (!value) return true
		const v = value.trim().toLowerCase()
		// ScreenScraper often returns placeholder values like "4and25caracteres".
		// Be tolerant of spelling variants and any future placeholder tweaks.
		if (v.includes("4and25")) return true
		if (v.includes("caracter") || v.includes("carater")) return true
		if (v === "xxxx" || v === "xxxxx" || v === "0") return true
		return false
	}
	const params = parsed.searchParams

	const currentDevId = params.get("devid")
	if (isPlaceholder(currentDevId) && creds.devId) {
		params.set("devid", creds.devId)
	}

	const currentDevPassword = params.get("devpassword")
	if (isPlaceholder(currentDevPassword) && creds.devPassword) {
		params.set("devpassword", creds.devPassword)
	}

	const currentSsid = params.get("ssid")
	if (isPlaceholder(currentSsid) && creds.username) {
		params.set("ssid", creds.username)
	}

	const currentSsPassword = params.get("sspassword")
	if (isPlaceholder(currentSsPassword) && creds.password) {
		params.set("sspassword", creds.password)
	}

	return parsed.toString()
}

/**
 * Download all requested media for a game
 * Returns paths to downloaded files and success status
 */
export async function downloadMediaForGame(
	game: ScreenScraperGame,
	baseName: string,
	mediaDir: string,
	options: MediaDownloadOptions,
	onMediaStart?: (mediaType: "box" | "screenshot" | "video") => void,
	onMediaComplete?: (
		mediaType: "box" | "screenshot" | "video",
		result: {
			ok: boolean
			error?: string | undefined
		},
	) => void,
): Promise<MediaDownloadResult> {
	const wantsBox = options.boxArt !== false
	const wantsSS = options.screenshot === true
	const wantsVideo = options.video === true
	const overwrite = options.overwrite === true
	const verbose = options.verbose === true
	const creds = {
		username: options.username,
		password: options.password,
		devId: options.devId,
		devPassword: options.devPassword,
	}

	const result: MediaDownloadResult = {
		media: {},
		hadAny: false,
		downloadedAny: false,
	}

	if (!wantsBox && !wantsSS && !wantsVideo) {
		return result
	}

	mkdirSync(mediaDir, { recursive: true })

	// Box art
	if (wantsBox) {
		if (game.media.boxFront) {
			const format = game.media.boxFront.format || "png"
			const ext = format.startsWith(".") ? format : `.${format}`
			const boxPath = join(mediaDir, `${baseName}-box${ext}`)
			const url = normalizeScreenScraperMediaUrl(game.media.boxFront.url, creds)

			onMediaStart?.("box")
			const downloadResult = await ensureMediaFile(
				url,
				boxPath,
				overwrite,
				verbose,
			)
			onMediaComplete?.("box", {
				ok: downloadResult.ok,
				...(downloadResult.error ? { error: downloadResult.error } : {}),
			})

			if (downloadResult.ok) {
				result.media.boxArt = boxPath
				result.hadAny = true
				if (downloadResult.downloaded) {
					result.downloadedAny = true
				}
			}
		} else {
			// Check for existing media
			const existingPath = findExistingMedia(mediaDir, baseName, "box", [
				".png",
				".jpg",
				".jpeg",
				".gif",
				".webp",
			])
			if (existingPath) {
				result.media.boxArt = existingPath
				result.hadAny = true
			}
		}
	}

	// Screenshot
	if (wantsSS) {
		if (game.media.screenshot) {
			const format = game.media.screenshot.format || "png"
			const ext = format.startsWith(".") ? format : `.${format}`
			const ssPath = join(mediaDir, `${baseName}-screenshot${ext}`)
			const url = normalizeScreenScraperMediaUrl(
				game.media.screenshot.url,
				creds,
			)

			onMediaStart?.("screenshot")
			const downloadResult = await ensureMediaFile(
				url,
				ssPath,
				overwrite,
				verbose,
			)
			onMediaComplete?.("screenshot", {
				ok: downloadResult.ok,
				...(downloadResult.error ? { error: downloadResult.error } : {}),
			})

			if (downloadResult.ok) {
				result.media.screenshot = ssPath
				result.hadAny = true
				if (downloadResult.downloaded) {
					result.downloadedAny = true
				}
			}
		} else {
			const existingPath = findExistingMedia(mediaDir, baseName, "screenshot", [
				".png",
				".jpg",
				".jpeg",
				".gif",
				".webp",
			])
			if (existingPath) {
				result.media.screenshot = existingPath
				result.hadAny = true
			}
		}
	}

	// Video
	if (wantsVideo) {
		if (game.media.video) {
			const format = game.media.video.format || "mp4"
			const ext = format.startsWith(".") ? format : `.${format}`
			const videoPath = join(mediaDir, `${baseName}-video${ext}`)
			const url = normalizeScreenScraperMediaUrl(game.media.video.url, creds)

			onMediaStart?.("video")
			const downloadResult = await ensureMediaFile(
				url,
				videoPath,
				overwrite,
				verbose,
			)
			onMediaComplete?.("video", {
				ok: downloadResult.ok,
				...(downloadResult.error ? { error: downloadResult.error } : {}),
			})

			if (downloadResult.ok) {
				result.media.video = videoPath
				result.hadAny = true
				if (downloadResult.downloaded) {
					result.downloadedAny = true
				}
			}
		} else {
			const existingPath = findExistingMedia(mediaDir, baseName, "video", [
				".mp4",
				".webm",
			])
			if (existingPath) {
				result.media.video = existingPath
				result.hadAny = true
			}
		}
	}

	return result
}

/**
 * Find existing media file with any of the given extensions
 */
function findExistingMedia(
	mediaDir: string,
	baseName: string,
	suffix: string,
	extensions: string[],
): string | undefined {
	for (const ext of extensions) {
		const path = join(mediaDir, `${baseName}-${suffix}${ext}`)
		if (existsSync(path)) {
			return path
		}
	}
	return undefined
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
