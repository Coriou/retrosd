import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		exclude: ["test/contract/**/*.test.ts"], // Contract tests are manual-only
		globals: false, // Explicit imports preferred
		environment: "node",
		testTimeout: 30000,
		setupFiles: ["test/helpers/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "html"],
			include: ["src/**/*.ts"],
			exclude: ["src/ui/**", "src/cli/**", "src/bootstrap.ts", "src/logger.ts"],
			thresholds: {
				// Critical modules - parsing and data integrity
				"src/romname.ts": { statements: 85, branches: 60 },
				"src/filters.ts": { statements: 75, branches: 55 },
				"src/hash.ts": { statements: 95, branches: 90 },
				// IO modules - reliability critical
				"src/extract.ts": { statements: 55 },
				"src/scan/stats.ts": { statements: 90 },
			},
		},
	},
})
