/**
 * Backpressure controller for download concurrency
 *
 * Inspired by Myrient Downloader v4.0.2: prevents memory overflow when
 * network speed exceeds disk write speed by limiting both concurrent
 * downloads AND total bytes in flight.
 */

export interface BackpressureOptions {
	/** Maximum bytes allowed in flight across all downloads */
	maxBytesInFlight: number
	/** Maximum concurrent download operations */
	maxConcurrent: number
	/** Callback for monitoring (optional) */
	onStateChange?: ((state: BackpressureState) => void) | undefined
}

export interface BackpressureState {
	bytesInFlight: number
	activeTasks: number
	queuedTasks: number
	maxBytesInFlight: number
	maxConcurrent: number
}

interface QueuedTask {
	resolve: () => void
	estimatedBytes: number
}

/**
 * Controls download concurrency based on both file count and byte limits.
 *
 * Usage:
 * ```ts
 * const controller = new BackpressureController({
 *   maxBytesInFlight: 100 * 1024 * 1024,  // 100MB
 *   maxConcurrent: 8,
 * })
 *
 * // Before starting a download:
 * await controller.acquire(fileSize)
 *
 * // In finally block after download completes:
 * controller.release(actualBytesDownloaded)
 * ```
 */
export class BackpressureController {
	private bytesInFlight = 0
	private activeTasks = 0
	private readonly queue: QueuedTask[] = []
	private readonly maxBytesInFlight: number
	private readonly maxConcurrent: number
	private readonly onStateChange:
		| ((state: BackpressureState) => void)
		| undefined

	constructor(options: BackpressureOptions) {
		this.maxBytesInFlight = options.maxBytesInFlight
		this.maxConcurrent = options.maxConcurrent
		this.onStateChange = options.onStateChange
	}

	/**
	 * Get current controller state for monitoring
	 */
	getState(): BackpressureState {
		return {
			bytesInFlight: this.bytesInFlight,
			activeTasks: this.activeTasks,
			queuedTasks: this.queue.length,
			maxBytesInFlight: this.maxBytesInFlight,
			maxConcurrent: this.maxConcurrent,
		}
	}

	/**
	 * Check if we can accept a new task with the given byte estimate
	 */
	private canAcquire(estimatedBytes: number): boolean {
		// Always allow at least one task even if it exceeds byte limit
		// (handles case where single file > maxBytesInFlight)
		if (this.activeTasks === 0) {
			return true
		}

		return (
			this.activeTasks < this.maxConcurrent &&
			this.bytesInFlight + estimatedBytes <= this.maxBytesInFlight
		)
	}

	/**
	 * Acquire a slot for downloading. Resolves when it's safe to proceed.
	 *
	 * @param estimatedBytes - Expected size of the download (use 0 if unknown)
	 */
	async acquire(estimatedBytes: number): Promise<void> {
		// If we can acquire immediately, do so
		if (this.canAcquire(estimatedBytes)) {
			this.bytesInFlight += estimatedBytes
			this.activeTasks++
			this.notifyStateChange()
			return
		}

		// Otherwise, queue and wait
		return new Promise<void>(resolve => {
			this.queue.push({ resolve, estimatedBytes })
			this.notifyStateChange()
		})
	}

	/**
	 * Release a slot after download completes (success or failure).
	 *
	 * @param actualBytes - Actual bytes downloaded (may differ from estimate)
	 * @param estimatedBytes - Original estimate passed to acquire()
	 */
	release(actualBytes: number, estimatedBytes: number): void {
		// Adjust for difference between estimate and actual
		// (we reserved estimatedBytes, but only used actualBytes)
		this.bytesInFlight -= estimatedBytes
		this.activeTasks--

		// Try to wake up queued tasks
		this.processQueue()
		this.notifyStateChange()
	}

	/**
	 * Process queued tasks, starting any that can now proceed
	 */
	private processQueue(): void {
		while (this.queue.length > 0) {
			const next = this.queue[0]!
			if (!this.canAcquire(next.estimatedBytes)) {
				break
			}

			// Remove from queue and start
			this.queue.shift()
			this.bytesInFlight += next.estimatedBytes
			this.activeTasks++
			next.resolve()
		}
	}

	private notifyStateChange(): void {
		if (this.onStateChange) {
			this.onStateChange(this.getState())
		}
	}

	/**
	 * Wait for all active downloads to complete
	 */
	async drain(): Promise<void> {
		while (this.activeTasks > 0 || this.queue.length > 0) {
			await new Promise(resolve => setTimeout(resolve, 50))
		}
	}
}

/**
 * Default backpressure settings for typical use cases
 */
export const BACKPRESSURE_DEFAULTS = {
	/** Good for local SSDs */
	fast: {
		maxBytesInFlight: 200 * 1024 * 1024, // 200MB
		maxConcurrent: 12,
	},
	/** Balanced for most systems */
	balanced: {
		maxBytesInFlight: 100 * 1024 * 1024, // 100MB
		maxConcurrent: 8,
	},
	/** Conservative for NAS/HDD/slow SD cards */
	slow: {
		maxBytesInFlight: 50 * 1024 * 1024, // 50MB
		maxConcurrent: 4,
	},
} as const

/**
 * Create a backpressure controller with sensible defaults
 */
export function createBackpressureController(
	options: Partial<BackpressureOptions> = {},
): BackpressureController {
	return new BackpressureController({
		...BACKPRESSURE_DEFAULTS.balanced,
		...options,
	})
}
