/**
 * Contract tests for Myrient ROM catalog
 *
 * These tests verify that Myrient directory listing format hasn't changed
 * and that catalog URLs remain accessible. Run manually before releases.
 *
 * Usage: npm run test:contract
 */

import { describe, it, expect } from "vitest"
import { ROM_ENTRIES } from "../../src/roms.js"
import { checkUrlReachable } from "../helpers/index.js"

// Import private functions for testing (we need to test parsing)
// Note: In production, we'd export these or test via integration
const SOURCE_URLS: Record<string, string> = {
	"no-intro": "https://myrient.erista.me/files/No-Intro",
	redump: "https://myrient.erista.me/files/Redump",
}

describe("Myrient catalog", () => {
	// ─────────────────────────────────────────────────────────────────────────
	// Configuration stability
	// ─────────────────────────────────────────────────────────────────────────

	describe("configuration stability", () => {
		it("ROM entries match expected snapshot", () => {
			const snapshot = ROM_ENTRIES.map(e => ({
				key: e.key,
				source: e.source,
				remotePath: e.remotePath,
				destDir: e.destDir,
				extractGlob: e.extractGlob,
				extract: e.extract,
			}))

			expect(snapshot).toMatchSnapshot()
		})

		it("all entries have required properties", () => {
			for (const entry of ROM_ENTRIES) {
				expect(entry.key).toBeDefined()
				expect(entry.source).toBeDefined()
				expect(entry.remotePath).toBeDefined()
				expect(entry.archiveRegex).toBeInstanceOf(RegExp)
				expect(entry.extractGlob).toBeDefined()
				expect(entry.destDir).toBeDefined()
			}
		})

		it("no duplicate system keys", () => {
			const seen = new Set<string>()

			for (const entry of ROM_ENTRIES) {
				expect(seen.has(entry.key), `Duplicate key: ${entry.key}`).toBe(false)
				seen.add(entry.key)
			}
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Source URL structure
	// ─────────────────────────────────────────────────────────────────────────

	describe("source URLs", () => {
		it("all source URLs use HTTPS", () => {
			for (const [source, url] of Object.entries(SOURCE_URLS)) {
				expect(url, `${source} should use HTTPS`).toMatch(/^https:\/\//)
			}
		})

		it("remote paths are URL-encoded", () => {
			for (const entry of ROM_ENTRIES) {
				// Paths should contain %20 or similar encoding for spaces
				if (entry.remotePath.includes(" ")) {
					throw new Error(
						`Unencoded space in ${entry.key}: ${entry.remotePath}`,
					)
				}
			}
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Live reachability tests
	// ─────────────────────────────────────────────────────────────────────────

	describe("reachability (live network)", () => {
		it("Myrient No-Intro base URL is reachable", async () => {
			const result = await checkUrlReachable(SOURCE_URLS["no-intro"]!)

			expect(result.ok, `No-Intro: ${result.error || result.status}`).toBe(true)
		}, 15000)

		it("Myrient Redump base URL is reachable", async () => {
			const result = await checkUrlReachable(SOURCE_URLS["redump"]!)

			expect(result.ok, `Redump: ${result.error || result.status}`).toBe(true)
		}, 15000)

		it("sample system directory is accessible", async () => {
			// Test one well-known system directory
			const gbEntry = ROM_ENTRIES.find(e => e.key === "GB")
			if (!gbEntry) {
				console.log("GB entry not found, skipping")
				return
			}

			const url = `${SOURCE_URLS[gbEntry.source]}/${gbEntry.remotePath}`
			const result = await checkUrlReachable(url)

			expect(result.ok, `GB directory: ${result.error || result.status}`).toBe(
				true,
			)
		}, 15000)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Directory listing format
	// ─────────────────────────────────────────────────────────────────────────

	describe("directory listing format (live network)", () => {
		it("directory listing contains expected HTML structure", async () => {
			const gbEntry = ROM_ENTRIES.find(e => e.key === "GB")
			if (!gbEntry) {
				console.log("GB entry not found, skipping")
				return
			}

			const url = `${SOURCE_URLS[gbEntry.source]}/${gbEntry.remotePath}`
			const response = await fetch(url)
			const html = await response.text()

			// Verify expected structure for parsing
			expect(html).toContain("<a href=")
			expect(html).toContain(".zip")

			// Should contain table or pre structure (Myrient uses tables)
			const hasTable = html.includes("<table") || html.includes("<pre")
			expect(hasTable, "Missing table or pre element").toBe(true)

			// Check for size information
			const sizePatterns = [/\d+K/, /\d+M/, /\d+G/, /\d+ bytes/i]
			const hasSize = sizePatterns.some(p => p.test(html))
			expect(hasSize, "Missing file sizes").toBe(true)

			// Check for date information
			const datePattern = /\d{2}-[A-Za-z]{3}-\d{4}/
			expect(datePattern.test(html), "Missing dates").toBe(true)
		}, 30000)

		it("listing contains ROM files matching expected patterns", async () => {
			const gbEntry = ROM_ENTRIES.find(e => e.key === "GB")
			if (!gbEntry) {
				console.log("GB entry not found, skipping")
				return
			}

			const url = `${SOURCE_URLS[gbEntry.source]}/${gbEntry.remotePath}`
			const response = await fetch(url)
			const html = await response.text()

			// Extract href values
			const hrefMatches = html.match(/href="([^"]+\.zip)"/gi) || []

			expect(hrefMatches.length).toBeGreaterThan(100)

			// Check for known patterns (URL-encoded or plain)
			// Myrient encodes parentheses: %28 = (, %29 = )
			const hasRegionTags = hrefMatches.some(h => {
				const decoded = decodeURIComponent(h)
				return (
					decoded.includes("(USA)") ||
					decoded.includes("(Europe)") ||
					decoded.includes("(Japan)") ||
					decoded.includes("(World)")
				)
			})
			expect(hasRegionTags, "Missing region tags in filenames").toBe(true)
		}, 30000)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// System coverage
	// ─────────────────────────────────────────────────────────────────────────

	describe("system coverage", () => {
		it("covers expected systems", () => {
			const systems = new Set(ROM_ENTRIES.map(e => e.key))

			const expectedSystems = ["GB", "GBA", "GBC", "FC_CART", "MD", "PS"]

			for (const system of expectedSystems) {
				expect(systems.has(system), `Missing system: ${system}`).toBe(true)
			}
		})

		it("logs system configuration", () => {
			console.log("\nROM systems configured:")
			for (const entry of ROM_ENTRIES) {
				console.log(`  ${entry.key}: ${entry.source} -> ${entry.destDir}`)
			}
		})
	})
})
