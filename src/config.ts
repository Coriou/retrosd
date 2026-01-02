/**
 * Configuration management with Zod validation
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const ConfigSchema = z.object({
	jobs: z.number().int().min(1).max(16).default(4),
	retryCount: z.number().int().min(0).max(10).default(3),
	retryDelay: z.number().int().min(0).default(2),
	defaultPreset: z
		.enum(["usa", "english", "ntsc", "pal", "japanese", "all"])
		.optional(),
	defaultSources: z.array(z.enum(["no-intro", "redump"])).optional(),
	defaultSystems: z.array(z.string()).optional(),
	includePrerelease: z.boolean().default(false),
	includeUnlicensed: z.boolean().default(false),
})

export type Config = z.infer<typeof ConfigSchema>

const DEFAULT_CONFIG: Config = {
	jobs: 4,
	retryCount: 3,
	retryDelay: 2,
	includePrerelease: false,
	includeUnlicensed: false,
}

/**
 * Load configuration from ~/.brickrc (JSON format)
 */
export function loadConfig(): Config {
	const configPath = join(homedir(), ".brickrc")

	if (!existsSync(configPath)) {
		return DEFAULT_CONFIG
	}

	try {
		const raw = readFileSync(configPath, "utf-8")
		const parsed = JSON.parse(raw) as unknown
		return ConfigSchema.parse(parsed)
	} catch {
		// Invalid config, use defaults
		return DEFAULT_CONFIG
	}
}

export { DEFAULT_CONFIG }
