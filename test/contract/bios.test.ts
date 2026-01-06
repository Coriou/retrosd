/**
 * Contract tests for BIOS URLs
 *
 * These tests verify that BIOS download URLs remain reachable and detect
 * upstream changes that could break downloads. Run manually before releases.
 *
 * Usage: npm run test:contract
 */

import { describe, it, expect } from "vitest"
import { BIOS_ENTRIES, SYMLINK_ENTRIES } from "../../src/bios.js"
import { checkUrlsBatch } from "../helpers/index.js"

describe("BIOS URLs", () => {
	// ─────────────────────────────────────────────────────────────────────────
	// Snapshot tests - detect configuration changes
	// ─────────────────────────────────────────────────────────────────────────

	describe("configuration stability", () => {
		it("BIOS entries match expected snapshot", () => {
			// Extract stable properties for comparison
			const snapshot = BIOS_ENTRIES.map(e => ({
				system: e.system,
				filename: e.filename,
				urlHost: new URL(e.url).host,
				rename: e.rename,
			}))

			expect(snapshot).toMatchSnapshot()
		})

		it("symlink entries match expected snapshot", () => {
			expect(SYMLINK_ENTRIES).toMatchSnapshot()
		})

		it("all entries have required properties", () => {
			for (const entry of BIOS_ENTRIES) {
				expect(entry.system).toBeDefined()
				expect(entry.filename).toBeDefined()
				expect(entry.url).toBeDefined()
				expect(entry.url).toMatch(/^https?:\/\//)
			}
		})

		it("no duplicate filenames within same system", () => {
			const seen = new Map<string, Set<string>>()

			for (const entry of BIOS_ENTRIES) {
				if (!seen.has(entry.system)) {
					seen.set(entry.system, new Set())
				}
				const systemFiles = seen.get(entry.system)!

				expect(
					systemFiles.has(entry.filename),
					`Duplicate: ${entry.system}/${entry.filename}`,
				).toBe(false)

				systemFiles.add(entry.filename)
			}
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// URL structure tests
	// ─────────────────────────────────────────────────────────────────────────

	describe("URL structure", () => {
		it("all URLs use HTTPS", () => {
			const httpUrls = BIOS_ENTRIES.filter(e => !e.url.startsWith("https://"))

			// Allow some HTTP URLs for legacy compatibility but flag them
			if (httpUrls.length > 0) {
				console.warn(
					`Warning: ${httpUrls.length} BIOS URLs use HTTP instead of HTTPS`,
				)
			}
		})

		it("groups entries by source host", () => {
			const hostCounts = new Map<string, number>()

			for (const entry of BIOS_ENTRIES) {
				const host = new URL(entry.url).host
				hostCounts.set(host, (hostCounts.get(host) || 0) + 1)
			}

			// Log for visibility during contract testing
			console.log("\nBIOS URL sources:")
			for (const [host, count] of hostCounts.entries()) {
				console.log(`  ${host}: ${count} files`)
			}

			expect(hostCounts.size).toBeGreaterThan(0)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Live reachability tests
	// ─────────────────────────────────────────────────────────────────────────

	describe("reachability (live network)", () => {
		// Test a sample of URLs to avoid rate limiting
		// These tests make real network requests

		it("retroarch_system URLs are reachable", async () => {
			const retroarchUrls = BIOS_ENTRIES.filter(e =>
				e.url.includes("retroarch_system"),
			).slice(0, 5) // Test first 5

			if (retroarchUrls.length === 0) {
				console.log("No retroarch_system URLs to test")
				return
			}

			const results = await checkUrlsBatch(
				retroarchUrls.map(e => e.url),
				{ delayMs: 1000, timeoutMs: 15000 },
			)

			const failures = Array.from(results.entries()).filter(([, r]) => !r.ok)

			if (failures.length > 0) {
				console.error("\nUnreachable BIOS URLs:")
				for (const [url, result] of failures) {
					console.error(`  ${url}: ${result.status || result.error}`)
				}
			}

			expect(failures.length, `${failures.length} URLs unreachable`).toBe(0)
		}, 60000) // 60s timeout for network tests

		it("GitHub-hosted BIOS files are reachable", async () => {
			const githubUrls = BIOS_ENTRIES.filter(
				e =>
					e.url.includes("github.com") ||
					e.url.includes("raw.githubusercontent.com"),
			).slice(0, 3)

			if (githubUrls.length === 0) {
				console.log("No GitHub URLs to test")
				return
			}

			const results = await checkUrlsBatch(
				githubUrls.map(e => e.url),
				{ delayMs: 500, timeoutMs: 15000 },
			)

			const failures = Array.from(results.entries()).filter(([, r]) => !r.ok)

			expect(
				failures.length,
				`${failures.length} GitHub URLs unreachable`,
			).toBe(0)
		}, 30000)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// System coverage
	// ─────────────────────────────────────────────────────────────────────────

	describe("system coverage", () => {
		it("covers expected systems", () => {
			const systems = new Set(BIOS_ENTRIES.map(e => e.system))

			// Expected core systems with BIOS requirements
			const expectedSystems = ["GB", "GBC", "GBA", "PS", "FC"]

			for (const system of expectedSystems) {
				expect(systems.has(system), `Missing BIOS for ${system}`).toBe(true)
			}
		})

		it("logs system BIOS counts", () => {
			const systemCounts = new Map<string, number>()

			for (const entry of BIOS_ENTRIES) {
				systemCounts.set(
					entry.system,
					(systemCounts.get(entry.system) || 0) + 1,
				)
			}

			console.log("\nBIOS files per system:")
			for (const [system, count] of [...systemCounts.entries()].sort()) {
				console.log(`  ${system}: ${count} files`)
			}
		})
	})
})
