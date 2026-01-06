/**
 * Unit tests for file hashing
 *
 * Tests SHA-1 and CRC32 computation against known values to ensure
 * ROM verification integrity.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
	writeFileSync,
	unlinkSync,
	mkdtempSync,
	rmdirSync,
	existsSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashFile, verifyFile } from "../../src/hash.js"

describe("hashFile", () => {
	let tempDir: string
	let testFile: string

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "retrosd-hash-"))
		testFile = join(tempDir, "test.bin")
		// "hello" has well-known hashes for verification
		writeFileSync(testFile, "hello")
	})

	afterAll(() => {
		if (existsSync(testFile)) unlinkSync(testFile)
		if (existsSync(tempDir)) rmdirSync(tempDir)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// SHA-1 computation
	// ─────────────────────────────────────────────────────────────────────────

	describe("SHA-1", () => {
		it("computes correct SHA-1 for known content", async () => {
			const result = await hashFile(testFile)
			// SHA-1 of "hello"
			expect(result.sha1).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d")
		})

		it("returns lowercase hexadecimal", async () => {
			const result = await hashFile(testFile)
			expect(result.sha1).toMatch(/^[a-f0-9]{40}$/)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// CRC32 computation
	// ─────────────────────────────────────────────────────────────────────────

	describe("CRC32", () => {
		it("computes correct CRC32 for known content", async () => {
			const result = await hashFile(testFile)
			// CRC32 of "hello"
			expect(result.crc32).toBe("3610a686")
		})

		it("returns 8-character padded hexadecimal", async () => {
			const result = await hashFile(testFile)
			expect(result.crc32).toMatch(/^[a-f0-9]{8}$/)
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Size reporting
	// ─────────────────────────────────────────────────────────────────────────

	describe("size", () => {
		it("reports correct file size", async () => {
			const result = await hashFile(testFile)
			expect(result.size).toBe(5) // "hello" = 5 bytes
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ─────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("throws for missing file", async () => {
			await expect(hashFile("/nonexistent/file.bin")).rejects.toThrow()
		})

		it("handles empty file", async () => {
			const emptyFile = join(tempDir, "empty.bin")
			writeFileSync(emptyFile, "")

			const result = await hashFile(emptyFile)

			expect(result.size).toBe(0)
			// SHA-1 of empty string
			expect(result.sha1).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709")

			unlinkSync(emptyFile)
		})

		it("handles binary content", async () => {
			const binaryFile = join(tempDir, "binary.bin")
			// Write binary data
			const buffer = Buffer.from([0x00, 0xff, 0x80, 0x7f])
			writeFileSync(binaryFile, buffer)

			const result = await hashFile(binaryFile)

			expect(result.size).toBe(4)
			expect(result.sha1).toHaveLength(40)
			expect(result.crc32).toHaveLength(8)

			unlinkSync(binaryFile)
		})

		it("handles larger files efficiently", async () => {
			const largeFile = join(tempDir, "large.bin")
			// Write 1MB of data
			const buffer = Buffer.alloc(1024 * 1024, 0x42)
			writeFileSync(largeFile, buffer)

			const start = Date.now()
			const result = await hashFile(largeFile)
			const elapsed = Date.now() - start

			expect(result.size).toBe(1024 * 1024)
			expect(elapsed).toBeLessThan(5000) // Should complete in <5s

			unlinkSync(largeFile)
		})
	})
})

describe("verifyFile", () => {
	let tempDir: string
	let testFile: string

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "retrosd-verify-"))
		testFile = join(tempDir, "test.bin")
		writeFileSync(testFile, "hello")
	})

	afterAll(() => {
		if (existsSync(testFile)) unlinkSync(testFile)
		if (existsSync(tempDir)) rmdirSync(tempDir)
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Successful verification
	// ─────────────────────────────────────────────────────────────────────────

	describe("successful verification", () => {
		it("returns valid when SHA-1 matches", async () => {
			const result = await verifyFile(testFile, {
				sha1: "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
			})

			expect(result.valid).toBe(true)
			expect(result.mismatches).toEqual([])
		})

		it("returns valid when CRC32 matches", async () => {
			const result = await verifyFile(testFile, {
				crc32: "3610a686",
			})

			expect(result.valid).toBe(true)
		})

		it("returns valid when size matches", async () => {
			const result = await verifyFile(testFile, {
				size: 5,
			})

			expect(result.valid).toBe(true)
		})

		it("returns valid when all hashes match", async () => {
			const result = await verifyFile(testFile, {
				sha1: "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
				crc32: "3610a686",
				size: 5,
			})

			expect(result.valid).toBe(true)
			expect(result.mismatches).toEqual([])
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Failed verification
	// ─────────────────────────────────────────────────────────────────────────

	describe("failed verification", () => {
		it("detects SHA-1 mismatch", async () => {
			const result = await verifyFile(testFile, {
				sha1: "0000000000000000000000000000000000000000",
			})

			expect(result.valid).toBe(false)
			expect(result.mismatches).toContain("sha1")
		})

		it("detects CRC32 mismatch", async () => {
			const result = await verifyFile(testFile, {
				crc32: "00000000",
			})

			expect(result.valid).toBe(false)
			expect(result.mismatches).toContain("crc32")
		})

		it("detects size mismatch", async () => {
			const result = await verifyFile(testFile, {
				size: 100,
			})

			expect(result.valid).toBe(false)
			expect(result.mismatches).toContain("size")
		})

		it("reports all mismatches", async () => {
			const result = await verifyFile(testFile, {
				sha1: "invalid",
				crc32: "invalid",
				size: 0,
			})

			expect(result.valid).toBe(false)
			expect(result.mismatches).toContain("sha1")
			expect(result.mismatches).toContain("crc32")
			expect(result.mismatches).toContain("size")
		})
	})

	// ─────────────────────────────────────────────────────────────────────────
	// Actual hash return
	// ─────────────────────────────────────────────────────────────────────────

	describe("actual hash return", () => {
		it("returns actual computed hashes", async () => {
			const result = await verifyFile(testFile, {
				sha1: "wrong",
			})

			expect(result.actual.sha1).toBe(
				"aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
			)
			expect(result.actual.crc32).toBe("3610a686")
			expect(result.actual.size).toBe(5)
		})
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Known good hashes for ROM verification
// ─────────────────────────────────────────────────────────────────────────────

describe("known hash values", () => {
	it("documents expected hash behavior", () => {
		// This test documents the expected hashing behavior for reference
		// These are the known hashes that the system should produce

		const knownHashes = [
			{
				content: "",
				sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
				crc32: "00000000",
			},
			{
				content: "hello",
				sha1: "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
				crc32: "3610a686",
			},
			{
				content: "The quick brown fox jumps over the lazy dog",
				sha1: "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
				crc32: "414fa339",
			},
		]

		expect(knownHashes).toMatchSnapshot()
	})
})
