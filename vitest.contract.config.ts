import { defineConfig } from "vitest/config"

/**
 * Vitest config for contract tests (manual-only).
 *
 * Run with: npm run test:contract
 *
 * These tests verify remote resources and API formats. They should be
 * run manually before releases to detect upstream breaking changes.
 */
export default defineConfig({
	test: {
		include: ["test/contract/**/*.test.ts"],
		globals: false,
		environment: "node",
		testTimeout: 60000, // Network tests need longer timeout
		retry: 2, // Retry flaky network tests
		sequence: {
			shuffle: false, // Run in order to help with rate limiting
		},
	},
})
