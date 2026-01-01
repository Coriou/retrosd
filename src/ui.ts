/**
 * Terminal output helpers with consistent styling
 */

import chalk from 'chalk'

export const ui = {
  /** Section header with decorative border */
  header(text: string): void {
    console.log(chalk.cyan.bold(`\n═══ ${text} ═══\n`))
  },

  /** Success message with checkmark */
  success(text: string): void {
    console.log(chalk.green('✓') + ' ' + text)
  },

  /** Error message with X mark */
  error(text: string): void {
    console.error(chalk.red('✗') + ' ' + text)
  },

  /** Warning message */
  warn(text: string): void {
    console.error(chalk.yellow('⚠') + ' ' + text)
  },

  /** Info message */
  info(text: string): void {
    console.log(chalk.blue('ℹ') + ' ' + text)
  },

  /** Debug message (only shown if verbose) */
  debug(text: string, verbose: boolean): void {
    if (verbose) {
      console.log(chalk.dim('  → ' + text))
    }
  },

  /** Banner for startup */
  banner(version: string, target: string, jobs: number, filter?: string): void {
    console.log(chalk.bold('Brick SD Card Creator') + ` v${version}`)
    console.log(`Target: ${chalk.cyan(target)}`)
    console.log(`Jobs: ${chalk.cyan(String(jobs))} parallel downloads`)
    if (filter) {
      console.log(`Filter: ${chalk.cyan(filter)}`)
    }
    console.log()
  },

  /** Dry run warning banner */
  dryRunBanner(): void {
    console.log(chalk.yellow.bold('═══ DRY RUN MODE ═══'))
    console.log('No files will be downloaded. Showing what would happen.')
    console.log()
  },

  /** Format a list of results for summary */
  summarySection(title: string, items: string[], color: 'green' | 'red'): void {
    if (items.length === 0) return
    const colorFn = color === 'green' ? chalk.green : chalk.red
    const symbol = color === 'green' ? '✓' : '✗'
    console.log(colorFn(`${title} (${items.length}):`))
    for (const item of items) {
      console.log(`  ${symbol} ${item}`)
    }
  },

  /** Final status line */
  finalStatus(allSuccess: boolean): void {
    console.log()
    if (allSuccess) {
      console.log(chalk.green.bold('✓ All operations completed successfully!'))
    } else {
      console.log(chalk.yellow.bold('⚠ Some operations failed. See above for details.'))
    }
  },
}
