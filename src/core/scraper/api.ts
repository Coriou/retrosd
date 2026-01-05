/* eslint-disable no-mixed-spaces-and-tabs */
/**
 * ScreenScraper API communication
 *
 * Handles all HTTP communication with the ScreenScraper API including
 * credential validation, game search, and error normalization.
 */

import { Agent, fetch as undiciFetch } from "undici"
import type { LaneRateLimiter } from "./rate-limiter.js"
import type { ScreenScraperGame, SearchOptions } from "./types.js"
import { guessRomType } from "./types.js"
import { log } from "../../logger.js"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.screenscraper.fr/api2"
const USER_AGENT = "RetroSD/2.0.0"

// ScreenScraper is sensitive to aggressive connection reuse/pipelining.
// Use a dedicated agent with pipelining disabled to avoid spurious HTTP errors.
const SCREENSCRAPER_API_AGENT = new Agent({
	keepAliveTimeout: 30_000,
	keepAliveMaxTimeout: 60_000,
	connections: 8,
	pipelining: 0,
})

/** Environment variables for dev credentials */
const ENV_DEV_ID = process.env["SCREENSCRAPER_DEV_ID"] ?? ""
const ENV_DEV_PASSWORD = process.env["SCREENSCRAPER_DEV_PASSWORD"] ?? ""

/** Patterns indicating dev credential errors */
const DEV_CREDENTIAL_ERROR_PATTERNS = [
	/identifiants d[eé]veloppeur/i,
	/developer credentials?/i,
	/\bdevid\b/i,
]

// ─────────────────────────────────────────────────────────────────────────────
// Credential Helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface DevCredentials {
	devId?: string
	devPassword?: string
}

/**
 * Resolve dev credentials from options or environment
 */
export function resolveDevCredentials(options?: {
	devId?: string | undefined
	devPassword?: string | undefined
}): DevCredentials {
	const devId = (options?.devId ?? ENV_DEV_ID).trim()
	const devPassword = (options?.devPassword ?? ENV_DEV_PASSWORD).trim()
	if (!devId || !devPassword) {
		return {}
	}
	return { devId, devPassword }
}

/**
 * Check if an error message indicates dev credential issues
 */
export function isDevCredentialError(message: string): boolean {
	return DEV_CREDENTIAL_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

/**
 * Normalize ScreenScraper error messages
 */
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

/**
 * Check if an error is retryable
 */
function isRetryableApiError(message: string): boolean {
	return /limit|trop|maximum|busy|overload|timeout|tempor|deadlock|wsrep|aborted transaction/i.test(
		message,
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// API Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate ScreenScraper credentials and get thread limit
 */
export async function validateCredentials(
	username?: string,
	password?: string,
	devId?: string,
	devPassword?: string,
): Promise<{ valid: boolean; error?: string; maxThreads?: number }> {
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
			`${BASE_URL}/ssuserInfos.php?${params.toString()}`,
			{
				headers: { "User-Agent": USER_AGENT },
				dispatcher: SCREENSCRAPER_API_AGENT,
			},
		)

		if (!response.ok) {
			const raw = await response.text().catch(() => "")
			return {
				valid: false,
				error: raw
					? normalizeScreenScraperError(raw)
					: `HTTP ${response.status}`,
			}
		}

		const raw = await response.text()
		let data: unknown
		try {
			data = JSON.parse(raw)
		} catch {
			return {
				valid: false,
				error: normalizeScreenScraperError(raw),
			}
		}

		const resp = data as {
			response?: {
				error?: string
				ssuser?: { maxthreads?: number; maxdownloadspeed?: number }
			}
		}

		if (resp.response?.error) {
			const errorMsg = resp.response.error
			if (errorMsg.includes("Erreur d'identification")) {
				return {
					valid: false,
					error: "Invalid username or password",
				}
			}
			return { valid: false, error: normalizeScreenScraperError(errorMsg) }
		}

		const userInfo = resp.response?.ssuser
		if (!userInfo) {
			return { valid: true, maxThreads: 1 } // Anonymous
		}

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
 * Search ScreenScraper for a game
 */
export async function searchScreenScraper(
	systemId: number,
	romFilename: string,
	system: string,
	romSize: number,
	options: SearchOptions,
	apiLimiter: LaneRateLimiter,
): Promise<{ game?: ScreenScraperGame; error?: string }> {
	const params = new URLSearchParams({
		softname: "retrosd/2.0.0",
		output: "json",
		systemeid: systemId.toString(),
		romnom: romFilename,
		romtaille: romSize.toString(),
		romtype: guessRomType(system, romFilename),
	})

	// Add dev credentials
	const devCreds = resolveDevCredentials({
		devId: options.devId,
		devPassword: options.devPassword,
	})
	if (devCreds.devId && devCreds.devPassword) {
		params.set("devid", devCreds.devId)
		params.set("devpassword", devCreds.devPassword)
	}

	// Add user credentials
	if (options.username && options.password) {
		params.set("ssid", options.username)
		params.set("sspassword", options.password)
	}

	// Add hashes for better matching
	if (options.crc32) params.set("crc", options.crc32)
	if (options.sha1) params.set("sha1", options.sha1)

	const maxAttempts = 3
	const baseRetryDelayMs = 1200

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		await apiLimiter.wait()

		try {
			const response = await undiciFetch(
				`${BASE_URL}/jeuInfos.php?${params.toString()}`,
				{
					headers: { "User-Agent": USER_AGENT },
					dispatcher: SCREENSCRAPER_API_AGENT,
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

			let data: unknown
			try {
				data = JSON.parse(raw)
			} catch {
				log.scrape.warn(
					{ romFilename, raw: raw.slice(0, 200) },
					"ScreenScraper invalid JSON",
				)
				const trimmed = raw.trim()
				const looksLikeHtml = trimmed.startsWith("<")
				const retryable = looksLikeHtml || isRetryableApiError(trimmed)
				if (retryable && attempt < maxAttempts) {
					await sleep(baseRetryDelayMs * attempt)
					continue
				}
				return { error: normalizeScreenScraperError(raw) }
			}

			const resp = data as { response?: { error?: string; jeu?: unknown } }

			if (resp.response?.error) {
				const errorMessage = normalizeScreenScraperError(
					String(resp.response.error),
				)
				if (isRetryableApiError(errorMessage) && attempt < maxAttempts) {
					await sleep(baseRetryDelayMs * attempt)
					continue
				}
				log.scrape.warn(
					{ romFilename, apiError: resp.response.error },
					"ScreenScraper API error",
				)
				return { error: errorMessage }
			}

			const game = resp.response?.jeu as
				| {
						id?: number
						noms?: Array<{ text?: string }>
						region?: string
						medias?: Array<{
							type: string
							url: string
							format: string
							region?: string
						}>
				  }
				| undefined
			if (!game) {
				log.scrape.debug({ romFilename }, "game not found on ScreenScraper")
				return { error: "Game not found on ScreenScraper" }
			}

			// Extract media URLs
			const media: ScreenScraperGame["media"] = {}

			if (game.medias) {
				for (const m of game.medias) {
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

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
