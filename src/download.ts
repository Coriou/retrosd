/**
 * Download manager with retry logic and streaming
 */

import { createWriteStream, existsSync, renameSync, unlinkSync, statSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) retrosd-cli/1.0.0'

export interface DownloadOptions {
  retries: number
  delay: number
  quiet: boolean
  verbose: boolean
}

/**
 * Download a file with retry logic and streaming to disk
 */
export async function downloadFile(
  url: string,
  destPath: string,
  options: DownloadOptions
): Promise<{ success: boolean; skipped: boolean; error?: string }> {
  const { retries, delay } = options

  // Ensure directory exists
  await mkdir(dirname(destPath), { recursive: true })

  let attempt = 1
  let currentDelay = delay * 1000

  while (attempt <= retries) {
    const tmpPath = `${destPath}.tmp.${process.pid}`

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      })

      if (response.status === 304) {
        // Not modified
        return { success: true, skipped: true }
      }

      if (response.status === 404) {
        // Not found - don't retry
        return { success: false, skipped: false, error: 'Not found (404)' }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Stream to temp file
      const fileStream = createWriteStream(tmpPath)
      await pipeline(Readable.fromWeb(response.body as never), fileStream)

      // Verify file has content
      const stats = statSync(tmpPath)
      if (stats.size === 0) {
        unlinkSync(tmpPath)
        throw new Error('Downloaded file is empty')
      }

      // Move to final destination
      renameSync(tmpPath, destPath)
      return { success: true, skipped: false }
    } catch (err) {
      // Clean up temp file
      try {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath)
        }
      } catch {
        // Ignore cleanup errors
      }

      if (attempt >= retries) {
        return {
          success: false,
          skipped: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }

      // Wait before retry with exponential backoff
      await sleep(currentDelay)
      currentDelay *= 2
      attempt++
    }
  }

  return { success: false, skipped: false, error: 'Max retries exceeded' }
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
export function anyExtensionExists(destDir: string, baseNameWithoutExt: string): boolean {
  try {
    const files = readdirSync(destDir)
    return files.some((f) => {
      const fBase = f.substring(0, f.lastIndexOf('.'))
      return fBase === baseNameWithoutExt
    })
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
