/**
 * BIOS download definitions and logic
 * Ported from generate.sh with all download URLs
 */

import { mkdir, symlink, readlink, unlink, readdir, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { BiosEntry, SymlinkEntry, DownloadOptions, Summary, DownloadResult } from './types.js'
import { downloadFile, fileExists } from './download.js'
import { ui } from './ui.js'

const BASE_URL = 'https://raw.githubusercontent.com/Abdess/retroarch_system/libretro'

/**
 * All BIOS entries from the shell script
 */
export const BIOS_ENTRIES: BiosEntry[] = [
  // Nintendo
  {
    system: 'FC',
    filename: 'disksys.rom',
    url: `${BASE_URL}/Nintendo%20-%20Famicom%20Disk%20System/disksys.rom`,
  },
  {
    system: 'GB',
    filename: 'gb_bios.bin',
    url: `${BASE_URL}/Nintendo%20-%20Gameboy/gb_bios.bin`,
  },
  {
    system: 'GBA',
    filename: 'gba_bios.bin',
    url: `${BASE_URL}/Nintendo%20-%20Game%20Boy%20Advance/gba_bios.bin`,
  },
  {
    system: 'GBC',
    filename: 'gbc_bios.bin',
    url: `${BASE_URL}/Nintendo%20-%20Gameboy%20Color/gbc_bios.bin`,
  },

  // Sega
  {
    system: 'MD',
    filename: 'bios_CD_E.bin',
    url: `${BASE_URL}/Sega%20-%20Mega%20CD%20-%20Sega%20CD/bios_CD_E.bin`,
  },
  {
    system: 'MD',
    filename: 'bios_CD_J.bin',
    url: `${BASE_URL}/Sega%20-%20Mega%20CD%20-%20Sega%20CD/bios_CD_J.bin`,
  },
  {
    system: 'MD',
    filename: 'bios_CD_U.bin',
    url: `${BASE_URL}/Sega%20-%20Mega%20CD%20-%20Sega%20CD/bios_CD_U.bin`,
  },

  // NEC
  {
    system: 'PCE',
    filename: 'syscard3.pce',
    url: `${BASE_URL}/NEC%20-%20PC%20Engine%20-%20TurboGrafx%2016%20-%20SuperGrafx/syscard3.pce`,
  },

  // Pokemon Mini
  {
    system: 'PKM',
    filename: 'bios.min',
    url: `${BASE_URL}/Nintendo%20-%20Pokemon%20Mini/bios.min`,
  },

  // PRBOOM (Doom)
  {
    system: 'PRBOOM',
    filename: 'prboom.wad',
    url: `${BASE_URL}/Id%20Software%20-%20Doom/prboom.wad`,
  },

  // PlayStation
  {
    system: 'PS',
    filename: 'psxonpsp660.bin',
    url: 'https://github.com/gingerbeardman/PSX/raw/master/PSXONPSP660.BIN',
    rename: 'psxonpsp660.bin',
  },

  // Super Game Boy
  {
    system: 'SGB',
    filename: 'sgb.bios',
    url: `${BASE_URL}/Nintendo%20-%20Super%20Game%20Boy/sgb2.boot.rom`,
    rename: 'sgb.bios',
  },

  // Commodore Amiga (PUAE)
  {
    system: 'PUAE',
    filename: 'kick34005.A500',
    url: `${BASE_URL}/Commodore%20-%20Amiga/kick34005.A500`,
  },
  {
    system: 'PUAE',
    filename: 'kick40063.A600',
    url: `${BASE_URL}/Commodore%20-%20Amiga/kick40063.A600`,
  },
  {
    system: 'PUAE',
    filename: 'kick40068.A1200',
    url: `${BASE_URL}/Commodore%20-%20Amiga/kick40068.A1200`,
  },
  {
    system: 'PUAE',
    filename: 'kick40068.A4000',
    url: 'https://raw.githubusercontent.com/BatoceraPLUS/Batocera.PLUS-bios/main/Kickstart%20v3.1%20r40.68%20(1993)(Commodore)(A4000).rom',
    rename: 'kick40068.A4000',
  },
]

/**
 * Symlink entries (e.g., MGBA -> GBA BIOS)
 */
export const SYMLINK_ENTRIES: SymlinkEntry[] = [
  {
    system: 'MGBA',
    linkPath: 'MGBA/gba_bios.bin',
    targetPath: 'GBA/gba_bios.bin',
    label: 'MGBA: symlink to GBA BIOS',
  },
]

/**
 * FreeDoom download info
 */
const FREEDOOM_VERSION = '0.13.0'
const FREEDOOM_ARCHIVE = `freedoom-${FREEDOOM_VERSION}.zip`
const FREEDOOM_URL = `https://github.com/freedoom/freedoom/releases/download/v${FREEDOOM_VERSION}/${FREEDOOM_ARCHIVE}`

/**
 * Create all required BIOS directories
 */
export async function createBiosDirectories(biosDir: string): Promise<void> {
  const dirs = [
    'FC',
    'GB',
    'GBA',
    'GBC',
    'MD',
    'MGBA',
    'PCE',
    'PKM',
    'PS',
    'PUAE',
    'SGB',
    'PRBOOM/doom',
    'PRBOOM/doom-ultimate',
    'PRBOOM/doom2',
    'PRBOOM/freedoom',
    'PRBOOM/freedoom1',
    'PRBOOM/freedoom2',
    'PRBOOM/plutonia',
    'PRBOOM/tnt',
  ]

  for (const dir of dirs) {
    await mkdir(join(biosDir, dir), { recursive: true })
  }
}

/**
 * Download all BIOS files
 */
export async function downloadBios(biosDir: string, options: DownloadOptions): Promise<Summary> {
  ui.header('Downloading BIOS Files')

  await createBiosDirectories(biosDir)

  const results: DownloadResult[] = []

  // Download regular BIOS files
  for (const entry of BIOS_ENTRIES) {
    const destDir = join(biosDir, entry.system)
    const destFile = entry.rename ?? entry.filename
    const destPath = join(destDir, destFile)
    const label = `${entry.system}: ${destFile}`

    // Check if already exists (resume mode)
    if (options.resume && existsSync(destPath)) {
      ui.debug(`Skipping existing: ${label}`, options.verbose)
      results.push({ label: `${label} (exists)`, success: true, skipped: true })
      continue
    }

    if (options.dryRun) {
      ui.info(`[DRY-RUN] Would download: ${label}`)
      ui.debug(`URL: ${entry.url}`, options.verbose)
      results.push({ label: `${label} (dry-run)`, success: true })
      continue
    }

    const result = await downloadFile(entry.url, destPath, {
      retries: options.retryCount,
      delay: options.retryDelay,
      quiet: options.quiet,
      verbose: options.verbose,
    })

    if (result.success) {
      ui.success(label)
      results.push({ label, success: true, skipped: result.skipped })
    } else {
      ui.error(`Failed: ${label}` + (result.error ? ` - ${result.error}` : ''))
      results.push({ label, success: false, error: result.error })
    }
  }

  // Handle symlinks
  for (const entry of SYMLINK_ENTRIES) {
    const linkPath = join(biosDir, entry.linkPath)
    const targetPath = join(biosDir, entry.targetPath)

    if (options.dryRun) {
      ui.info(`[DRY-RUN] Would create symlink: ${entry.label}`)
      results.push({ label: `${entry.label} (dry-run)`, success: true })
      continue
    }

    try {
      const { lstatSync } = await import('node:fs')
      
      // Use lstatSync instead of existsSync because existsSync follows symlinks
      // and returns false for broken symlinks
      let pathExists = false
      let isSymlink = false
      try {
        const stats = lstatSync(linkPath)
        pathExists = true
        isSymlink = stats.isSymbolicLink()
      } catch {
        // Path doesn't exist
      }

      if (pathExists) {
        if (isSymlink) {
          // Symlink exists - consider it OK (may be relative or absolute path)
          ui.debug(`${entry.system}: symlink already exists`, options.verbose)
          results.push({ label: `${entry.system}: symlink OK`, success: true })
          continue
        } else {
          // Not a symlink (regular file), keep it
          ui.debug(`${entry.system}: file exists (not a symlink)`, options.verbose)
          results.push({ label: `${entry.system}: file exists (kept)`, success: true })
          continue
        }
      }

      // Ensure parent directory exists
      await mkdir(join(biosDir, entry.system), { recursive: true })

      // Create symlink (absolute path)
      await symlink(targetPath, linkPath)
      ui.success(`${entry.system}: symlink created`)
      results.push({ label: `${entry.system}: symlink created`, success: true })
    } catch (err) {
      ui.error(`Failed to create symlink: ${entry.label}`)
      results.push({
        label: entry.label,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Download and extract FreeDoom
  const freedoomResult = await downloadFreeDoom(biosDir, options)
  results.push(...freedoomResult)

  // Write PUAE readme
  if (!options.dryRun) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      join(biosDir, 'PUAE', 'README.txt'),
      'Downloaded available Amiga Kickstarts. Missing variants must be added manually from legal sources like Amiga Forever.\n'
    )
  }

  const completed = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  return { completed, failed }
}

/**
 * Download and extract FreeDoom WADs
 */
async function downloadFreeDoom(biosDir: string, options: DownloadOptions): Promise<DownloadResult[]> {
  const results: DownloadResult[] = []
  const prboomDir = join(biosDir, 'PRBOOM')
  const archivePath = join(prboomDir, FREEDOOM_ARCHIVE)

  // Download archive
  const label = `PRBOOM: FreeDoom ${FREEDOOM_VERSION}`

  if (options.resume && existsSync(archivePath)) {
    ui.debug(`Skipping existing: ${label}`, options.verbose)
    results.push({ label: `${label} (exists)`, success: true, skipped: true })
  } else if (options.dryRun) {
    ui.info(`[DRY-RUN] Would download: ${label}`)
    results.push({ label: `${label} (dry-run)`, success: true })
  } else {
    const result = await downloadFile(FREEDOOM_URL, archivePath, {
      retries: options.retryCount,
      delay: options.retryDelay,
      quiet: options.quiet,
      verbose: options.verbose,
    })

    if (result.success) {
      ui.success(label)
      results.push({ label, success: true })
    } else {
      ui.error(`Failed: ${label}`)
      results.push({ label, success: false, error: result.error })
      return results // Can't extract if download failed
    }
  }

  // Extract WADs if needed
  const freedoom1Path = join(prboomDir, 'freedoom1', 'freedoom1.wad')
  const freedoom2Path = join(prboomDir, 'freedoom2', 'freedoom2.wad')

  if (options.dryRun) {
    if (!existsSync(freedoom1Path) || !existsSync(freedoom2Path)) {
      ui.info('[DRY-RUN] Would extract FreeDoom WADs')
      results.push({ label: 'PRBOOM: FreeDoom WADs (dry-run)', success: true })
    }
    return results
  }

  if (!existsSync(freedoom1Path) || !existsSync(freedoom2Path)) {
    if (existsSync(archivePath)) {
      try {
        // Use unzip to extract specific files
        execSync(
          `unzip -n "${archivePath}" "freedoom-${FREEDOOM_VERSION}/freedoom1.wad" "freedoom-${FREEDOOM_VERSION}/freedoom2.wad" -d "${prboomDir}"`,
          { stdio: 'pipe' }
        )

        // Move to correct locations
        const extractedDir = join(prboomDir, `freedoom-${FREEDOOM_VERSION}`)

        const freedoom1Extracted = join(extractedDir, 'freedoom1.wad')
        const freedoom2Extracted = join(extractedDir, 'freedoom2.wad')

        if (existsSync(freedoom1Extracted)) {
          await mkdir(join(prboomDir, 'freedoom1'), { recursive: true })
          await rename(freedoom1Extracted, freedoom1Path)
        }

        if (existsSync(freedoom2Extracted)) {
          await mkdir(join(prboomDir, 'freedoom2'), { recursive: true })
          await rename(freedoom2Extracted, freedoom2Path)
        }

        // Clean up extracted directory
        await rm(extractedDir, { recursive: true, force: true })

        ui.success('FreeDoom WADs extracted')
        results.push({ label: 'PRBOOM: FreeDoom WADs extracted', success: true })
      } catch (err) {
        ui.error('Failed to extract FreeDoom WADs')
        results.push({
          label: 'PRBOOM: FreeDoom WADs',
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } else {
    ui.debug('FreeDoom WADs already present', options.verbose)
    results.push({ label: 'PRBOOM: FreeDoom WADs OK', success: true })
  }

  return results
}
