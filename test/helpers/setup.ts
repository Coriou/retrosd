/**
 * Vitest setup file - runs before all tests
 *
 * Configures the test environment to suppress noisy output and
 * set appropriate defaults for testing.
 */

// Suppress Pino logger output during tests
// The logger reads LOG_LEVEL at startup, so we set this before any imports
process.env["LOG_LEVEL"] = "silent"

// Suppress file logging during tests
process.env["LOG_LEVEL_FILE"] = "silent"

// Disable color output in CI for cleaner logs
if (process.env["CI"]) {
	process.env["NO_COLOR"] = "1"
}
