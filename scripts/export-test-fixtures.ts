#!/usr/bin/env npx tsx
/**
 * Export test fixtures from production database.
 *
 * This script extracts a representative sample of real data for use in
 * regression testing. The fixtures provide realistic test cases without
 * requiring network access during test runs.
 *
 * Usage:
 *   npx tsx scripts/export-test-fixtures.ts [dbPath]
 *
 * Default dbPath: _card/.retrosd.db
 */

import Database from "better-sqlite3"
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, "..")

const dbPath = process.argv[2] || join(projectRoot, "_card", ".retrosd.db")

if (!existsSync(dbPath)) {
	console.error(`❌ Database not found: ${dbPath}`)
	console.error(
		"   Provide path as argument or ensure _card/.retrosd.db exists",
	)
	process.exit(1)
}

const fixturesDir = join(projectRoot, "test", "fixtures")
mkdirSync(fixturesDir, { recursive: true })
mkdirSync(join(fixturesDir, "scraper-responses"), { recursive: true })

console.log(`📂 Reading from: ${dbPath}`)
const db = new Database(dbPath, { readonly: true })

// ─────────────────────────────────────────────────────────────────────────────
// ROM Filenames - Diverse samples for parsing tests
// ─────────────────────────────────────────────────────────────────────────────

interface FilenameRow {
	filename: string
	system: string
}

// Get diverse filename samples covering edge cases
const romSamples = db
	.prepare<[], FilenameRow>(
		`
  SELECT DISTINCT filename, system FROM remote_roms 
  WHERE 
    -- Multi-region samples
    (filename LIKE '%(%, %)%' AND filename NOT LIKE '%Disc%')
    -- Version/revision samples
    OR filename LIKE '%(Rev %)%'
    OR filename LIKE '%v1.%'
    -- Special flags
    OR filename LIKE '%(Beta)%'
    OR filename LIKE '%(Proto)%'
    OR filename LIKE '%(Unl)%'
    OR filename LIKE '%(Hack)%'
    OR filename LIKE '%(Homebrew)%'
    -- Disc samples
    OR filename LIKE '%(Disc %)%'
    -- Language tags
    OR filename LIKE '%(En,%)%'
    OR filename LIKE '%(%, En%)%'
  ORDER BY system, filename
  LIMIT 300
`,
	)
	.all()

// Also add some "normal" samples without special tags
const normalSamples = db
	.prepare<[], FilenameRow>(
		`
  SELECT DISTINCT filename, system FROM remote_roms 
  WHERE 
    filename NOT LIKE '%(Beta)%'
    AND filename NOT LIKE '%(Proto)%'
    AND filename NOT LIKE '%(Unl)%'
    AND filename NOT LIKE '%(Hack)%'
    AND filename NOT LIKE '%(Rev %)%'
    AND filename NOT LIKE '%(Disc %)%'
    AND filename LIKE '%(%)%'
  ORDER BY RANDOM()
  LIMIT 100
`,
	)
	.all()

const allFilenames = [...romSamples, ...normalSamples]
const uniqueFilenames = Array.from(
	new Map(allFilenames.map(r => [r.filename, r])).values(),
)

writeFileSync(
	join(fixturesDir, "rom-filenames.json"),
	JSON.stringify(
		{
			description:
				"Representative ROM filenames from production catalog for parsing tests",
			exportedAt: new Date().toISOString(),
			count: uniqueFilenames.length,
			samples: uniqueFilenames.map(r => ({
				filename: r.filename,
				system: r.system,
			})),
		},
		null,
		"\t",
	),
)

console.log(`✓ Exported ${uniqueFilenames.length} ROM filenames`)

// ─────────────────────────────────────────────────────────────────────────────
// Scraper Cache - API response format samples
// ─────────────────────────────────────────────────────────────────────────────

interface ScraperRow {
	cache_key: string
	game_id: number | null
	game_name: string | null
	media_urls: string | null
}

const scraperSamples = db
	.prepare<[], ScraperRow>(
		`
  SELECT cache_key, game_id, game_name, media_urls 
  FROM scraper_cache 
  WHERE media_urls IS NOT NULL 
    AND game_id IS NOT NULL
  ORDER BY RANDOM()
  LIMIT 20
`,
	)
	.all()

writeFileSync(
	join(fixturesDir, "scraper-responses", "samples.json"),
	JSON.stringify(
		{
			description: "ScreenScraper API response samples for format validation",
			exportedAt: new Date().toISOString(),
			count: scraperSamples.length,
			samples: scraperSamples.map(row => ({
				cacheKey: row.cache_key,
				gameId: row.game_id,
				gameName: row.game_name,
				mediaUrls: row.media_urls ? JSON.parse(row.media_urls) : null,
			})),
		},
		null,
		"\t",
	),
)

console.log(`✓ Exported ${scraperSamples.length} scraper cache samples`)

// ─────────────────────────────────────────────────────────────────────────────
// System Stats - For reference
// ─────────────────────────────────────────────────────────────────────────────

interface StatsRow {
	system: string
	count: number
}

const systemStats = db
	.prepare<[], StatsRow>(
		`
  SELECT system, COUNT(*) as count 
  FROM remote_roms 
  GROUP BY system 
  ORDER BY count DESC
`,
	)
	.all()

writeFileSync(
	join(fixturesDir, "catalog-stats.json"),
	JSON.stringify(
		{
			description: "Catalog statistics for reference",
			exportedAt: new Date().toISOString(),
			systems: systemStats,
			totalRoms: systemStats.reduce((sum, s) => sum + s.count, 0),
		},
		null,
		"\t",
	),
)

console.log(`✓ Exported catalog stats (${systemStats.length} systems)`)

db.close()
console.log("\n✅ All fixtures exported to test/fixtures/")
