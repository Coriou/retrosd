/**
 * ROM source definitions and download logic
 * Ported from generate.sh ROM_ENTRIES and download_rom_entry
 */

import { mkdir } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execSync } from 'node:child_process'
import type { RomEntry, Source, DownloadOptions, Summary, DownloadResult, RegionPreset } from './types.js'
import { downloadFile, anyExtensionExists } from './download.js'
import { runParallel } from './parallel.js'
import { applyFilters, getPresetFilter, getExclusionFilter, parseCustomFilter } from './filters.js'
import { ui } from './ui.js'

/**
 * Source base URLs
 */
const SOURCE_URLS: Record<Source, string> = {
  'no-intro': 'https://myrient.erista.me/files/No-Intro',
  redump: 'https://myrient.erista.me/files/Redump',
}

/**
 * Map system keys to destination directories
 */
const DEST_DIRS: Record<string, string> = {
  FC_CART: 'FC',
  FC_FDS: 'FC',
  GB: 'GB',
  GBA: 'GBA',
  GBC: 'GBC',
  MD: 'MD',
  MD_SEGA_CD: 'MD',
  PCE: 'PCE',
  PKM: 'PKM',
  SGB: 'SGB',
  PS: 'PS',
}

/**
 * All ROM entries from the shell script
 */
export const ROM_ENTRIES: RomEntry[] = [
  {
    key: 'FC_CART',
    source: 'no-intro',
    remotePath: 'Nintendo%20-%20Famicom/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.nes',
    label: 'Famicom (cart)',
    extract: true,
    destDir: 'FC',
  },
  {
    key: 'FC_FDS',
    source: 'no-intro',
    remotePath: 'Nintendo%20-%20Family%20Computer%20Disk%20System%20%28FDS%29/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.fds',
    label: 'Famicom Disk System',
    extract: true,
    destDir: 'FC',
  },
  {
    key: 'GB',
    source: 'no-intro',
    remotePath: 'Nintendo%20-%20Game%20Boy/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.gb',
    label: 'Game Boy',
    extract: true,
    destDir: 'GB',
  },
  {
    key: 'GBA',
    source: 'no-intro',
    remotePath: 'Nintendo%20-%20Game%20Boy%20Advance/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.gba',
    label: 'Game Boy Advance',
    extract: true,
    destDir: 'GBA',
  },
  {
    key: 'GBC',
    source: 'no-intro',
    remotePath: 'Nintendo%20-%20Game%20Boy%20Color/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.gbc',
    label: 'Game Boy Color',
    extract: true,
    destDir: 'GBC',
  },
  {
    key: 'MD',
    source: 'no-intro',
    remotePath: 'Sega%20-%20Mega%20Drive%20-%20Genesis/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.md',
    label: 'Mega Drive / Genesis',
    extract: true,
    destDir: 'MD',
  },
  {
    key: 'PCE',
    source: 'no-intro',
    remotePath: 'NEC%20-%20PC%20Engine%20-%20TurboGrafx-16/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.pce',
    label: 'PC Engine',
    extract: true,
    destDir: 'PCE',
  },
  {
    key: 'PKM',
    source: 'no-intro',
    remotePath: 'Nintendo%20-%20Pokemon%20Mini/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.min',
    label: 'Pokemon Mini',
    extract: true,
    destDir: 'PKM',
  },
  {
    key: 'SGB',
    source: 'no-intro',
    remotePath: 'Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/',
    archiveRegex: /\.zip$/,
    extractGlob: '*.sfc',
    label: 'Super Game Boy (SNES)',
    extract: true,
    destDir: 'SGB',
  },
  {
    key: 'PS',
    source: 'redump',
    remotePath: 'Sony%20-%20PlayStation/',
    archiveRegex: /\.(zip|7z)$/,
    extractGlob: '*',
    label: 'PlayStation (Redump)',
    extract: false,
    destDir: 'PS',
  },
  {
    key: 'MD_SEGA_CD',
    source: 'redump',
    remotePath: 'Sega%20-%20Mega-CD%20-%20Sega%20CD/',
    archiveRegex: /\.(zip|7z)$/,
    extractGlob: '*',
    label: 'Mega CD / Sega CD (Redump)',
    extract: false,
    destDir: 'MD',
  },
]

/**
 * Get ROM entries filtered by sources
 */
export function getEntriesBySources(sources: Source[]): RomEntry[] {
  return ROM_ENTRIES.filter((entry) => sources.includes(entry.source))
}

/**
 * Get ROM entries filtered by keys
 */
export function getEntriesByKeys(keys: string[]): RomEntry[] {
  return ROM_ENTRIES.filter((entry) => keys.includes(entry.key))
}

/**
 * Parse listing HTML from myrient to extract file links
 */
function parseListing(html: string, archiveRegex: RegExp): string[] {
  const matches = html.matchAll(/href="([^"]+)"/g)
  const files: string[] = []

  for (const match of matches) {
    const href = match[1]
    if (href && archiveRegex.test(href)) {
      // Decode URL-encoded filename
      files.push(decodeURIComponent(href))
    }
  }

  return files
}

/**
 * Download ROMs for a single entry
 */
export async function downloadRomEntry(
  entry: RomEntry,
  romsDir: string,
  options: DownloadOptions & {
    preset?: RegionPreset
    filter?: string
    includePrerelease: boolean
    includeUnlicensed: boolean
  }
): Promise<DownloadResult> {
  const baseUrl = SOURCE_URLS[entry.source]
  const destDir = join(romsDir, entry.destDir)

  await mkdir(destDir, { recursive: true })

  if (options.dryRun) {
    ui.info(`[DRY-RUN] Would fetch ROM listing: ${entry.label}`)
    ui.debug(`Source: ${baseUrl}/${entry.remotePath}`, options.verbose)
    ui.debug(`Dest: ${destDir}`, options.verbose)
    return { label: `${entry.label} (dry-run)`, success: true }
  }

  ui.info(`Fetching listing for: ${entry.label}`)

  // Fetch directory listing
  let listing: string[]
  try {
    const response = await fetch(`${baseUrl}/${entry.remotePath}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) retrosd-cli/1.0.0',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const html = await response.text()
    listing = parseListing(html, entry.archiveRegex)
  } catch (err) {
    return {
      label: `${entry.label} [${entry.source}]`,
      success: false,
      error: `Failed to fetch listing: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // Apply filters
  const regionFilter = options.preset
    ? getPresetFilter(options.preset)
    : options.filter
      ? parseCustomFilter(options.filter)
      : null

  const exclusionFilter = getExclusionFilter({
    includePrerelease: options.includePrerelease,
    includeUnlicensed: options.includeUnlicensed,
  })

  const filteredListing = applyFilters(listing, { regionFilter, exclusionFilter })

  ui.debug(`Listing: ${listing.length} files, after filter: ${filteredListing.length}`, options.verbose)

  // Check which files need downloading
  let skippedExisting = 0
  const toDownload: string[] = []

  for (const filename of filteredListing) {
    const baseNoExt = filename.substring(0, filename.lastIndexOf('.'))

    // Check if file already exists (either archive or extracted)
    if (existsSync(join(destDir, filename)) || anyExtensionExists(destDir, baseNoExt)) {
      skippedExisting++
      continue
    }

    toDownload.push(filename)
  }

  if (toDownload.length === 0) {
    ui.success(`${entry.label}: nothing to download (skipped ${skippedExisting} existing)`)
    return {
      label: `${entry.label} [${entry.source}]: skipped ${skippedExisting} existing`,
      success: true,
    }
  }

  ui.info(`${entry.label}: downloading ${toDownload.length} files (${skippedExisting} skipped) [${options.jobs} parallel]`)

  // Download files in parallel
  const results = await runParallel(
    toDownload,
    async (filename) => {
      const destPath = join(destDir, filename)
      const url = `${baseUrl}/${entry.remotePath}${encodeURIComponent(filename)}`

      const result = await downloadFile(url, destPath, {
        retries: options.retryCount,
        delay: options.retryDelay,
        quiet: true, // Quiet during parallel downloads
        verbose: false,
      })

      if (!result.success) {
        throw new Error(result.error ?? 'Download failed')
      }

      return filename
    },
    {
      concurrency: options.jobs,
      label: entry.label,
      quiet: options.quiet,
    }
  )

  // Extract archives if needed
  if (entry.extract && results.success.length > 0) {
    ui.info('Extracting archives...')
    for (const filename of results.success) {
      const archivePath = join(destDir, filename)
      if (existsSync(archivePath) && archivePath.endsWith('.zip')) {
        try {
          execSync(`unzip -n -j "${archivePath}" "${entry.extractGlob}" -d "${destDir}"`, {
            stdio: 'pipe',
          })
        } catch {
          // Extraction failed, keep the archive
        }
      }
    }
  }

  const downloaded = results.success.length
  const failed = results.failed.length

  if (failed > 0) {
    ui.warn(`${entry.label}: ${downloaded} downloaded, ${skippedExisting} skipped, ${failed} failed`)
    return {
      label: `${entry.label} [${entry.source}]: ${downloaded} ok, ${skippedExisting} skipped, ${failed} failed`,
      success: false,
    }
  }

  ui.success(`${entry.label}: ${downloaded} downloaded, ${skippedExisting} skipped`)
  return {
    label: `${entry.label} [${entry.source}]: ${downloaded} ok, ${skippedExisting} skipped`,
    success: true,
  }
}

/**
 * Download ROMs for multiple entries
 */
export async function downloadRoms(
  entries: RomEntry[],
  romsDir: string,
  options: DownloadOptions & {
    preset?: RegionPreset
    filter?: string
    includePrerelease: boolean
    includeUnlicensed: boolean
  }
): Promise<Summary> {
  ui.header('Downloading ROMs')

  const results: DownloadResult[] = []

  for (const entry of entries) {
    const result = await downloadRomEntry(entry, romsDir, options)
    results.push(result)
  }

  const completed = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  return { completed, failed }
}

/**
 * Create all required ROM directories
 */
export async function createRomDirectories(romsDir: string): Promise<void> {
  const dirs = ['FC', 'GB', 'GBA', 'GBC', 'MD', 'MGBA', 'PCE', 'PKM', 'PRBOOM', 'PS', 'PUAE', 'SGB']

  for (const dir of dirs) {
    await mkdir(join(romsDir, dir), { recursive: true })
  }
}
