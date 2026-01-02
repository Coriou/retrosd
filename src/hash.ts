/**
 * File hashing and verification utilities
 * Supports SHA-1 and CRC32 for ROM verification against DAT files
 */

import { createReadStream, existsSync } from "node:fs"
import { createHash } from "node:crypto"

export interface FileHash {
	sha1: string
	crc32: string
	size: number
}

/**
 * Calculate SHA-1 and CRC32 for a file
 * Uses streaming to handle large files efficiently
 */
export async function hashFile(filePath: string): Promise<FileHash> {
	if (!existsSync(filePath)) {
		throw new Error(`File not found: ${filePath}`)
	}

	const sha1Hash = createHash("sha1")
	let crc32 = 0xffffffff
	let size = 0

	const stream = createReadStream(filePath)

	for await (const chunk of stream) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		sha1Hash.update(buffer)
		size += buffer.length

		// CRC32 calculation
		for (let i = 0; i < buffer.length; i++) {
			crc32 = ((crc32 >>> 8) ^ CRC32_TABLE[(crc32 ^ buffer[i]!) & 0xff]!) >>> 0
		}
	}

	crc32 = (crc32 ^ 0xffffffff) >>> 0

	return {
		sha1: sha1Hash.digest("hex"),
		crc32: crc32.toString(16).padStart(8, "0"),
		size,
	}
}

/**
 * Verify a file against expected hashes
 */
export async function verifyFile(
	filePath: string,
	expected: Partial<FileHash>,
): Promise<{ valid: boolean; actual: FileHash; mismatches: string[] }> {
	const actual = await hashFile(filePath)
	const mismatches: string[] = []

	if (expected.sha1 && actual.sha1 !== expected.sha1) {
		mismatches.push("sha1")
	}
	if (expected.crc32 && actual.crc32 !== expected.crc32) {
		mismatches.push("crc32")
	}
	if (expected.size !== undefined && actual.size !== expected.size) {
		mismatches.push("size")
	}

	return {
		valid: mismatches.length === 0,
		actual,
		mismatches,
	}
}

// CRC32 lookup table
const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
	let crc = i
	for (let j = 0; j < 8; j++) {
		crc = (crc & 1) !== 0 ? (0xedb88320 ^ (crc >>> 1)) >>> 0 : crc >>> 1
	}
	CRC32_TABLE[i] = crc >>> 0
}
