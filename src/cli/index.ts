#!/usr/bin/env node
/**
 * RetroSD CLI - Brick SD Card Creator
 * State-of-the-art BIOS & ROM downloader for retro gaming consoles
 */

import '../bootstrap.js'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Command } from 'commander'
import { loadConfig } from '../config.js'
import { ui } from '../ui.js'
import { downloadBios } from '../bios.js'
import { downloadRoms, createRomDirectories, getEntriesBySources, getEntriesByKeys, ROM_ENTRIES } from '../roms.js'
import {
  promptConfirmRomDownload,
  promptSources,
  promptSystems,
  promptFilter,
  setupPromptHandlers,
} from '../prompts.js'
import type { Source, RomEntry, RegionPreset, DownloadResult, DiskProfile } from '../types.js'

const VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// CLI Definition
// ─────────────────────────────────────────────────────────────────────────────

const program = new Command()

program
  .name('retrosd')
  .version(VERSION)
  .description('Brick SD Card Creator – BIOS & ROM downloader for retro gaming consoles')
  .argument('<target>', 'Path to SD card root directory')
  .option('-n, --dry-run', 'Preview actions without downloading', false)
  .option('-j, --jobs <number>', 'Number of parallel downloads', '4')
  .option('--bios-only', 'Only download BIOS files', false)
  .option('--roms-only', 'Only download ROMs (skip BIOS)', false)
  .option('--preset <name>', 'Filter preset: usa, english, ntsc, pal, japanese, all')
  .option('-f, --filter <regex>', 'Custom filter pattern')
  .option('--sources <list>', 'Comma-separated sources: no-intro,redump')
  .option('--systems <list>', 'Comma-separated system keys: GB,GBA,MD,etc.')
  .option('--resume', 'Resume interrupted downloads', false)
  .option('--non-interactive', 'No prompts (for automation)', false)
  .option('-q, --quiet', 'Minimal output', false)
  .option('--verbose', 'Debug output', false)
  .option('--include-prerelease', 'Include beta/demo/proto ROMs', false)
  .option('--include-unlicensed', 'Include unlicensed/pirate ROMs', false)
  .option(
    '--disk-profile <profile>',
    'Disk speed profile: fast (SSD), balanced (HDD), slow (SD card/NAS)',
    'balanced'
  )
  .action(run)

// ─────────────────────────────────────────────────────────────────────────────
// Main Action
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  target: string
  dryRun: boolean
  jobs: string
  biosOnly: boolean
  romsOnly: boolean
  preset?: string
  filter?: string
  sources?: string
  systems?: string
  resume: boolean
  nonInteractive: boolean
  quiet: boolean
  verbose: boolean
  includePrerelease: boolean
  includeUnlicensed: boolean
  diskProfile: string
}

async function run(target: string, options: Omit<CliArgs, 'target'>): Promise<void> {
  setupPromptHandlers()

  // Load config
  const config = loadConfig()

  // Merge CLI options with config defaults
  const jobs = Math.min(Math.max(parseInt(options.jobs, 10) || config.jobs, 1), 16)
  const dryRun = options.dryRun
  const resume = options.resume
  const quiet = options.quiet
  const verbose = options.verbose
  const biosOnly = options.biosOnly
  const romsOnly = options.romsOnly
  const nonInteractive = options.nonInteractive || !process.stdin.isTTY
  const includePrerelease = options.includePrerelease ?? config.includePrerelease
  const includeUnlicensed = options.includeUnlicensed ?? config.includeUnlicensed

  // Validate disk profile
  const validProfiles = ['fast', 'balanced', 'slow'] as const
  const diskProfile = validProfiles.includes(options.diskProfile as typeof validProfiles[number])
    ? (options.diskProfile as DiskProfile)
    : 'balanced'

  // Validate target directory
  if (!existsSync(target)) {
    ui.error(`Directory does not exist: ${target}`)
    process.exit(1)
  }

  // Set up paths
  const biosDir = join(target, 'Bios')
  const romsDir = join(target, 'Roms')

  // Print banner
  if (dryRun) {
    ui.dryRunBanner()
  }

  ui.banner(VERSION, target, jobs, options.filter ?? options.preset, diskProfile)

  // Create directories
  await createRomDirectories(romsDir)

  // Download options
  const downloadOptions = {
    dryRun,
    resume,
    verbose,
    quiet,
    jobs,
    retryCount: config.retryCount,
    retryDelay: config.retryDelay,
  }

  // Track results for summary
  const allBiosResults: DownloadResult[] = []
  const allRomResults: DownloadResult[] = []

  // ─────────────────────────────────────────────────────────────────────────────
  // BIOS Downloads
  // ─────────────────────────────────────────────────────────────────────────────

  if (!romsOnly) {
    const biosSummary = await downloadBios(biosDir, downloadOptions)
    allBiosResults.push(...biosSummary.completed, ...biosSummary.failed)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ROM Downloads
  // ─────────────────────────────────────────────────────────────────────────────

  if (!biosOnly) {
    let selectedSources: Source[]
    let selectedEntries: RomEntry[]
    let preset: RegionPreset | undefined
    let filter: string | undefined

    // Handle sources
    if (options.sources) {
      selectedSources = options.sources.split(',').map((s) => s.trim().replace('-', '-') as Source)
    } else if (nonInteractive) {
      ui.info('Skipping ROM downloads (non-interactive, no sources specified).')
      await printSummary(allBiosResults, allRomResults, dryRun)
      return
    } else {
      // Interactive: prompt for confirmation first
      const shouldDownloadRoms = await promptConfirmRomDownload()
      if (!shouldDownloadRoms) {
        ui.info('Skipping ROM downloads.')
        await printSummary(allBiosResults, allRomResults, dryRun)
        return
      }

      selectedSources = await promptSources()
    }

    // Handle systems
    if (options.systems) {
      const keys = options.systems.split(',').map((s) => s.trim())
      selectedEntries = getEntriesByKeys(keys).filter((e) => selectedSources.includes(e.source))
    } else if (nonInteractive) {
      selectedEntries = getEntriesBySources(selectedSources)
    } else {
      selectedEntries = await promptSystems(selectedSources)
    }

    if (selectedEntries.length === 0) {
      ui.info('No ROM systems selected.')
      await printSummary(allBiosResults, allRomResults, dryRun)
      return
    }

    // Handle filter
    if (options.preset) {
      preset = options.preset as RegionPreset
    } else if (options.filter) {
      filter = options.filter
    } else if (!nonInteractive) {
      const filterChoice = await promptFilter()
      preset = filterChoice.preset
      filter = filterChoice.custom
    }

    // Download ROMs
    const romSummary = await downloadRoms(selectedEntries, romsDir, {
      ...downloadOptions,
      ...(preset !== undefined ? { preset } : {}),
      ...(filter !== undefined ? { filter } : {}),
      includePrerelease,
      includeUnlicensed,
      diskProfile,
    })

    allRomResults.push(...romSummary.completed, ...romSummary.failed)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────────

  await printSummary(allBiosResults, allRomResults, dryRun)
}

async function printSummary(
  biosResults: DownloadResult[],
  romResults: DownloadResult[],
  dryRun: boolean
): Promise<void> {
  ui.header('Summary')

  const biosCompleted = biosResults.filter((r) => r.success)
  const biosFailed = biosResults.filter((r) => !r.success)
  const romCompleted = romResults.filter((r) => r.success)
  const romFailed = romResults.filter((r) => !r.success)

  if (biosCompleted.length > 0) {
    ui.summarySection(
      'BIOS Downloads Completed',
      biosCompleted.map((r) => r.label),
      'green'
    )
  }

  if (biosFailed.length > 0) {
    console.log()
    ui.summarySection(
      'BIOS Downloads Failed',
      biosFailed.map((r) => r.label + (r.error ? ` - ${r.error}` : '')),
      'red'
    )
  }

  if (romCompleted.length > 0) {
    console.log()
    ui.summarySection(
      'ROM Downloads Completed',
      romCompleted.map((r) => r.label),
      'green'
    )
  }

  if (romFailed.length > 0) {
    console.log()
    ui.summarySection(
      'ROM Downloads Failed',
      romFailed.map((r) => r.label + (r.error ? ` - ${r.error}` : '')),
      'red'
    )
  }

  const allSuccess = biosFailed.length === 0 && romFailed.length === 0
  ui.finalStatus(allSuccess)

  if (dryRun) {
    console.log()
    ui.info('Dry run complete. Run without --dry-run to actually download.')
  } else if (allSuccess) {
    console.log()
    ui.success('Setup complete!')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

program.parse()
