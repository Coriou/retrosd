/**
 * Parallel execution with concurrency control and progress tracking
 */

import pLimit from 'p-limit'
import ora, { type Ora } from 'ora'

export interface ParallelResult<T> {
  success: T[]
  failed: { item: unknown; error: string }[]
}

export interface ParallelOptions {
  concurrency: number
  label: string
  quiet: boolean
}

/**
 * Run async tasks in parallel with limited concurrency
 */
export async function runParallel<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ParallelOptions
): Promise<ParallelResult<R>> {
  const { concurrency, label, quiet } = options
  const limit = pLimit(concurrency)

  const success: R[] = []
  const failed: { item: unknown; error: string }[] = []
  let completed = 0
  const total = items.length

  let spinner: Ora | null = null
  if (!quiet && total > 0) {
    spinner = ora({
      text: `${label}: 0/${total}`,
      prefixText: '',
    }).start()
  }

  const updateProgress = () => {
    if (spinner) {
      spinner.text = `${label}: ${completed}/${total}`
    }
  }

  const tasks = items.map((item, index) =>
    limit(async () => {
      try {
        const result = await fn(item, index)
        success.push(result)
      } catch (err) {
        failed.push({
          item,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        completed++
        updateProgress()
      }
    })
  )

  await Promise.all(tasks)

  if (spinner) {
    if (failed.length === 0) {
      spinner.succeed(`${label}: ${total} completed`)
    } else {
      spinner.warn(`${label}: ${success.length} completed, ${failed.length} failed`)
    }
  }

  return { success, failed }
}

/**
 * Create a simple progress spinner for a single operation
 */
export function createSpinner(text: string, quiet: boolean): Ora | null {
  if (quiet) return null
  return ora(text).start()
}
