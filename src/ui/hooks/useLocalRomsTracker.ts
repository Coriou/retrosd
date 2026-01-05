/**
 * React hook for tracking downloaded ROMs in SQLite
 *
 * Records completed downloads to the local_roms table for
 * collection tracking and search functionality.
 */

import { useCallback, useRef } from "react"
import { getDb } from "../../db/index.js"
import { recordDownload } from "../../db/queries/local-roms.js"
import type { DownloadCompleteEvent } from "../../core/types.js"
import { log } from "../../logger.js"

/**
 * Hook that provides a callback for recording download completions.
 *
 * @param dbPath Path to SQLite database (null to disable tracking)
 * @returns Callback to invoke on each download completion
 */
export function useLocalRomsTracker(dbPath: string | null) {
	// Cache db connection check to avoid repeated lookups
	const dbRef = useRef<ReturnType<typeof getDb> | null>(null)

	const track = useCallback(
		(event: DownloadCompleteEvent) => {
			if (!dbPath) return

			try {
				// Lazy-init db connection
				if (!dbRef.current) {
					dbRef.current = getDb(dbPath)
				}

				recordDownload(dbRef.current, {
					localPath: event.localPath,
					fileSize: event.bytesDownloaded,
					system: event.system,
					filename: event.filename,
				})

				log.db.debug(
					{
						system: event.system,
						filename: event.filename,
						localPath: event.localPath,
					},
					"recorded download in local_roms",
				)
			} catch (err) {
				// Non-fatal: log and continue
				log.db.warn(
					{
						error: err instanceof Error ? err.message : String(err),
						filename: event.filename,
					},
					"failed to record download in local_roms",
				)
			}
		},
		[dbPath],
	)

	return dbPath ? track : null
}
