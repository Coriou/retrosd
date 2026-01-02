/**
 * Download manager with retry logic, streaming, Range resume, and backpressure
 *
 * State-of-the-art implementation inspired by Myrient Downloader v4.0.2:
 * - Streaming to disk with proper backpressure
 * - Range header support for resuming partial downloads
 * - .part files for crash recovery
 * - Size verification after download
 */

import {
	createWriteStream,
	existsSync,
	renameSync,
	unlinkSync,
	statSync,
	readdirSync,
	openSync,
	closeSync,
} from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) retrosd-cli/1.0.0"

export interface DownloadOptions {
	retries: number
	delay: number
	quiet: boolean
	verbose: boolean
}

export interface DownloadResult {
	success: boolean
	skipped: boolean
	bytesDownloaded: number
	error?: string
}

/**
 * Get the .part file path for a destination
 */
function getPartPath(destPath: string): string {
	return `${destPath}.part`
}

/**
 * Get existing partial download size, if any
 */
function getPartialSize(partPath: string): number {
	try {
		if (existsSync(partPath)) {
			return statSync(partPath).size
		}
	} catch {
		// Ignore errors
	}
	return 0
}

/**
 * Download a file with retry logic, streaming, and Range resume support
 *
 * Features:
 * - Resumes from .part files using HTTP Range header
 * - Streams directly to disk (no memory buffering)
 * - Verifies final size matches Content-Length
 * - Atomic rename on completion
 * - Exponential backoff retries
 */
export async function downloadFile(
	url: string,
	destPath: string,
	options: DownloadOptions,
	expectedSize?: number,
): Promise<DownloadResult> {
	const { retries, delay } = options
	const partPath = getPartPath(destPath)

	// Ensure directory exists
	await mkdir(dirname(destPath), { recursive: true })

	let attempt = 1
	let currentDelay = delay * 1000

	while (attempt <= retries) {
		try {
			// Check for existing partial download
			const existingSize = getPartialSize(partPath)
			const headers: Record<string, string> = {
				"User-Agent": USER_AGENT,
			}

			// Request remaining bytes if we have a partial file
			if (existingSize > 0) {
				headers["Range"] = `bytes=${existingSize}-`
			}

			const response = await fetch(url, { headers })

			if (response.status === 304) {
				// Not modified - file is complete
				return { success: true, skipped: true, bytesDownloaded: 0 }
			}

			if (response.status === 404) {
				// Not found - don't retry
				cleanupPartFile(partPath)
				return {
					success: false,
					skipped: false,
					bytesDownloaded: 0,
					error: "Not found (404)",
				}
			}

			if (response.status === 416) {
				// Range not satisfiable - file might be complete or corrupted
				// Check if we already have the full file
				if (expectedSize !== undefined && existingSize >= expectedSize) {
					// We have all bytes, rename to final
					renameSync(partPath, destPath)
					return { success: true, skipped: false, bytesDownloaded: 0 }
				}
				// Corrupted partial, start fresh
				cleanupPartFile(partPath)
				continue // Retry from start
			}

			if (!response.ok && response.status !== 206) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			if (!response.body) {
				throw new Error("No response body")
			}

			// Determine expected total size
			let totalSize = expectedSize
			if (response.status === 206) {
				// Partial content - parse Content-Range header
				const contentRange = response.headers.get("Content-Range")
				if (contentRange) {
					const match = contentRange.match(/bytes \d+-\d+\/(\d+)/)
					if (match && match[1]) {
						totalSize = parseInt(match[1], 10)
					}
				}
			} else {
				// Full content
				const contentLength = response.headers.get("Content-Length")
				if (contentLength) {
					totalSize = parseInt(contentLength, 10)
				}
				// Starting fresh, clear any partial
				cleanupPartFile(partPath)
			}

			// Stream to .part file (append if resuming 206, create if 200)
			const isResume = response.status === 206
			const fileStream = createWriteStream(partPath, {
				flags: isResume ? "a" : "w",
				highWaterMark: 1024 * 1024, // 1MB buffer for better disk throughput
			})

			await pipeline(Readable.fromWeb(response.body as never), fileStream)

			// Verify file has content
			const finalStats = statSync(partPath)
			if (finalStats.size === 0) {
				cleanupPartFile(partPath)
				throw new Error("Downloaded file is empty")
			}

			// Verify size matches expected (if known)
			if (totalSize !== undefined && finalStats.size !== totalSize) {
				// Size mismatch - might be truncated, keep .part for resume
				throw new Error(
					`Size mismatch: expected ${totalSize}, got ${finalStats.size}`,
				)
			}

			// Atomic rename to final destination
			if (existsSync(destPath)) {
				unlinkSync(destPath)
			}
			renameSync(partPath, destPath)

			const bytesDownloaded = isResume
				? finalStats.size - existingSize
				: finalStats.size
			return { success: true, skipped: false, bytesDownloaded }
		} catch (err) {
			// Don't clean up .part file on network errors - keep for resume
			// Only clean on unrecoverable errors (404, empty file)

			if (attempt >= retries) {
				return {
					success: false,
					skipped: false,
					bytesDownloaded: 0,
					error: err instanceof Error ? err.message : String(err),
				}
			}

			// Wait before retry with exponential backoff (capped at 30s)
			await sleep(Math.min(currentDelay, 30000))
			currentDelay *= 2
			attempt++
		}
	}

	return {
		success: false,
		skipped: false,
		bytesDownloaded: 0,
		error: "Max retries exceeded",
	}
}

/**
 * Clean up a .part file
 */
function cleanupPartFile(partPath: string): void {
	try {
		if (existsSync(partPath)) {
			unlinkSync(partPath)
		}
	} catch {
		// Ignore cleanup errors
	}
}

/**
 * Check if a file already exists (for resume mode)
 */
export function fileExists(destDir: string, filename: string): boolean {
	const destPath = join(destDir, filename)
	return existsSync(destPath)
}

/**
 * Check if any file with matching base name exists (for extracted ROMs)
 * e.g., if "Game.zip" was extracted to "Game.nes", consider it downloaded
 */
export function anyExtensionExists(
	destDir: string,
	baseNameWithoutExt: string,
): boolean {
	try {
		const files = readdirSync(destDir)
		return files.some(f => {
			const fBase = f.substring(0, f.lastIndexOf("."))
			return fBase === baseNameWithoutExt
		})
	} catch {
		return false
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
