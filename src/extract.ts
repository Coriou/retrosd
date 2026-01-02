/**
 * Streaming ZIP extraction using yauzl
 *
 * Replaces blocking `execSync(unzip)` with non-blocking, memory-efficient
 * streaming extraction. Extracts to .part files then atomically renames.
 */

import {
	createWriteStream,
	existsSync,
	renameSync,
	unlinkSync,
	mkdirSync,
} from "node:fs"
import { pipeline } from "node:stream/promises"
import { dirname, join, basename, extname } from "node:path"
import yauzl from "yauzl"

export interface ExtractOptions {
	/** Glob pattern to match files for extraction (e.g., '*.nes', '*.gb') */
	extractGlob: string
	/** Delete archive after successful extraction */
	deleteArchive: boolean
	/** Flatten directory structure (extract all to destDir root) */
	flatten: boolean
}

export interface ExtractResult {
	success: boolean
	extractedFiles: string[]
	error?: string
}

/**
 * Convert glob pattern to regex for matching
 * Supports: *.ext, *, specific filenames
 */
function globToRegex(glob: string): RegExp {
	if (glob === "*") {
		return /.*/ // Match everything
	}

	// Escape special regex chars except *
	const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
	// Convert * to .*
	const pattern = escaped.replace(/\*/g, ".*")
	return new RegExp(`^${pattern}$`, "i")
}

/**
 * Promisified yauzl.open
 */
function openZip(path: string): Promise<yauzl.ZipFile> {
	return new Promise((resolve, reject) => {
		yauzl.open(
			path,
			{ lazyEntries: true, autoClose: false },
			(err, zipFile) => {
				if (err) reject(err)
				else if (!zipFile) reject(new Error("Failed to open zip file"))
				else resolve(zipFile)
			},
		)
	})
}

/**
 * Get readable stream for a zip entry
 */
function openReadStream(
	zipFile: yauzl.ZipFile,
	entry: yauzl.Entry,
): Promise<NodeJS.ReadableStream> {
	return new Promise((resolve, reject) => {
		zipFile.openReadStream(entry, (err, stream) => {
			if (err) reject(err)
			else if (!stream) reject(new Error("Failed to open read stream"))
			else resolve(stream)
		})
	})
}

/**
 * Extract a ZIP archive using streaming (non-blocking)
 *
 * Features:
 * - Streams entries directly to disk (low memory)
 * - Writes to .part files then atomic rename
 * - Supports glob filtering
 * - Optional archive deletion after success
 */
export async function extractZip(
	archivePath: string,
	destDir: string,
	options: ExtractOptions,
): Promise<ExtractResult> {
	const { extractGlob, deleteArchive, flatten } = options
	const extractedFiles: string[] = []
	const globRegex = globToRegex(extractGlob)

	// Ensure destination exists
	mkdirSync(destDir, { recursive: true })

	let zipFile: yauzl.ZipFile | null = null

	try {
		zipFile = await openZip(archivePath)
		const entryCount = zipFile.entryCount

		// Process entries one by one (streaming, low memory)
		await new Promise<void>((resolve, reject) => {
			if (!zipFile) return reject(new Error("Zip file not opened"))

			const zf = zipFile

			zf.on("error", reject)
			zf.on("end", resolve)

			zf.on("entry", (entry: yauzl.Entry) => {
				void (async () => {
					// Skip directories
					if (entry.fileName.endsWith("/")) {
						zf.readEntry()
						return
					}

					// Get just the filename (flatten) or preserve path
					const entryName = flatten ? basename(entry.fileName) : entry.fileName

					// Check glob match
					const nameToMatch = flatten ? entryName : basename(entry.fileName)
					if (!globRegex.test(nameToMatch)) {
						zf.readEntry()
						return
					}

					// Determine output path
					const outputPath = join(destDir, entryName)
					const partPath = `${outputPath}.part.${process.pid}`

					// Ensure parent directory exists
					mkdirSync(dirname(outputPath), { recursive: true })

					// Stream extract to .part file
					const readStream = await openReadStream(zf, entry)
					const writeStream = createWriteStream(partPath)

					await pipeline(readStream, writeStream)

					// Atomic rename
					if (existsSync(outputPath)) {
						unlinkSync(outputPath) // Remove existing file
					}
					renameSync(partPath, outputPath)
					extractedFiles.push(entryName)

					// Continue to next entry
					zf.readEntry()
				})().catch(reject)
			})

			// Start reading entries
			zf.readEntry()
		})

		// Close zip file
		zipFile.close()

		// Delete archive if requested and extraction succeeded
		if (deleteArchive && extractedFiles.length > 0 && existsSync(archivePath)) {
			unlinkSync(archivePath)
		}

		return { success: true, extractedFiles }
	} catch (err) {
		// Cleanup on error
		if (zipFile) {
			try {
				zipFile.close()
			} catch {
				// Ignore close errors
			}
		}

		return {
			success: false,
			extractedFiles,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/**
 * Check if a file is a ZIP archive by extension
 */
export function isZipArchive(filename: string): boolean {
	const ext = extname(filename).toLowerCase()
	return ext === ".zip"
}

/**
 * Batch extract multiple archives with concurrency control
 */
export async function extractArchives(
	archives: Array<{ path: string; destDir: string }>,
	options: ExtractOptions,
	concurrency: number = 2,
): Promise<{
	success: string[]
	failed: Array<{ path: string; error: string }>
}> {
	const success: string[] = []
	const failed: Array<{ path: string; error: string }> = []

	// Process in batches to limit concurrent file handles
	for (let i = 0; i < archives.length; i += concurrency) {
		const batch = archives.slice(i, i + concurrency)
		const results = await Promise.all(
			batch.map(async ({ path, destDir }) => {
				const result = await extractZip(path, destDir, options)
				return { path, result }
			}),
		)

		for (const { path, result } of results) {
			if (result.success) {
				success.push(path)
			} else {
				failed.push({ path, error: result.error ?? "Unknown error" })
			}
		}
	}

	return { success, failed }
}
