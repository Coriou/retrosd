/**
 * Format conversion utilities
 * Handles compression/conversion of disc-based ROMs to CHD, CSO, etc.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { ui } from "./ui.js"

/**
 * Check if a command-line tool is available
 */
async function hasCommand(command: string): Promise<boolean> {
	return new Promise(resolve => {
		const proc = spawn("which", [command], { stdio: "ignore" })
		proc.on("close", code => {
			resolve(code === 0)
		})
	})
}

export function chdmanInstallHint(): string {
	return "chdman not found. Install MAME tools: brew install mame (macOS) or apt-get install mame-tools (Linux)"
}

export async function checkChdman(): Promise<
	{ ok: true } | { ok: false; error: string }
> {
	if (await hasCommand("chdman")) return { ok: true }
	return { ok: false, error: chdmanInstallHint() }
}

/**
 * Convert BIN/CUE to CHD format
 * Requires chdman from MAME tools
 */
export async function convertToChd(
	cuePath: string,
	outputPath: string,
	options: { verbose?: boolean; quiet?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
	const chdman = await checkChdman()
	if (!chdman.ok) return { success: false, error: chdman.error }

	if (!existsSync(cuePath)) {
		return { success: false, error: `File not found: ${cuePath}` }
	}

	return new Promise(resolve => {
		const args = ["createcd", "-i", cuePath, "-o", outputPath]
		const proc = spawn("chdman", args, {
			stdio: options.verbose ? "inherit" : "ignore",
		})

		proc.on("close", code => {
			if (code === 0) {
				resolve({ success: true })
			} else {
				resolve({
					success: false,
					error: `chdman exited with code ${code}`,
				})
			}
		})

		proc.on("error", err => {
			resolve({ success: false, error: err.message })
		})
	})
}

/**
 * Convert ISO to CSO format (PSP games)
 * Requires maxcso tool
 */
export async function convertToCso(
	isoPath: string,
	outputPath: string,
	options: { verbose?: boolean; quiet?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
	if (!(await hasCommand("maxcso"))) {
		return {
			success: false,
			error:
				"maxcso not found. Install from: https://github.com/unknownbrackets/maxcso",
		}
	}

	if (!existsSync(isoPath)) {
		return { success: false, error: `File not found: ${isoPath}` }
	}

	return new Promise(resolve => {
		const args = ["--block=2048", isoPath, "-o", outputPath]
		const proc = spawn("maxcso", args, {
			stdio: options.verbose ? "inherit" : "ignore",
		})

		proc.on("close", code => {
			if (code === 0) {
				resolve({ success: true })
			} else {
				resolve({
					success: false,
					error: `maxcso exited with code ${code}`,
				})
			}
		})

		proc.on("error", err => {
			resolve({ success: false, error: err.message })
		})
	})
}

/**
 * Auto-convert ROMs in a directory based on file type
 */
export async function convertRomsInDirectory(
	directory: string,
	options: {
		deleteOriginals?: boolean
		verbose?: boolean
		quiet?: boolean
	} = {},
): Promise<{ converted: number; failed: number; skipped: number }> {
	const { readdirSync, unlinkSync, statSync } = await import("node:fs")

	let converted = 0
	let failed = 0
	let skipped = 0

	if (!existsSync(directory)) {
		if (!options.quiet) {
			ui.warn(`Directory not found: ${directory}`)
		}
		return { converted, failed, skipped }
	}

	const files = readdirSync(directory)
	const cueFiles = files.filter(f => f.toLowerCase().endsWith(".cue"))
	const cuesToConvert = cueFiles.filter(
		f => !existsSync(join(directory, f.replace(/\.cue$/i, ".chd"))),
	)
	if (cuesToConvert.length > 0) {
		const chdman = await checkChdman()
		if (!chdman.ok) {
			if (!options.quiet) ui.error(chdman.error)
			return { converted: 0, failed: cuesToConvert.length, skipped: 0 }
		}
	}

	for (const filename of files) {
		const filePath = join(directory, filename)
		const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()

		// Convert CUE/BIN to CHD
		if (ext === ".cue") {
			const outputPath = filePath.replace(/\.cue$/i, ".chd")

			// Skip if CHD already exists
			if (existsSync(outputPath)) {
				skipped++
				continue
			}

			if (!options.quiet) {
				ui.info(`Converting ${filename} to CHD...`)
			}

			const result = await convertToChd(filePath, outputPath, options)

			if (result.success) {
				converted++

				if (options.deleteOriginals) {
					try {
						const deleteSidecar = (originalFilename: string) => {
							const sidecarPath = join(
								directory,
								originalFilename.replace(/\.[^.]+$/, "") + ".json",
							)
							if (existsSync(sidecarPath)) {
								unlinkSync(sidecarPath)
							}
						}

						// Delete .cue file
						unlinkSync(filePath)
						deleteSidecar(filename)

						// Delete associated .bin files
						const binBaseName = filename.replace(/\.cue$/i, "")
						const binFiles = files.filter(
							f =>
								f.startsWith(binBaseName) && f.toLowerCase().endsWith(".bin"),
						)
						for (const binFile of binFiles) {
							const binPath = join(directory, binFile)
							if (existsSync(binPath)) {
								unlinkSync(binPath)
								deleteSidecar(binFile)
							}
						}
					} catch (err) {
						if (!options.quiet) {
							ui.debug(
								`Failed to delete originals: ${err instanceof Error ? err.message : String(err)}`,
								options.verbose ?? false,
							)
						}
					}
				}

				if (!options.quiet) {
					const chdSize = statSync(outputPath).size
					ui.success(
						`Created ${filename.replace(/\.cue$/i, ".chd")} (${formatBytes(chdSize)})`,
					)
				}
			} else {
				failed++
				if (!options.quiet) {
					ui.error(`Failed to convert ${filename}: ${result.error}`)
				}
			}
		}

		// Convert ISO to CSO (if needed for PSP/etc)
		// This is less common, so we skip by default
		// Add similar logic if CSO conversion is needed
	}

	return { converted, failed, skipped }
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B"
	const k = 1024
	const sizes = ["B", "KB", "MB", "GB", "TB"]
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
