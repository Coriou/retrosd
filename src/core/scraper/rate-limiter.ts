/**
 * Lane-based rate limiter for ScreenScraper API
 *
 * Each "lane" (thread) enforces its own minimum delay between requests.
 * This allows N threads to each make requests at the rate limit while
 * maintaining overall API compliance.
 *
 * ScreenScraper limits: 1 request per 1.2 seconds per thread (Skyscraper standard)
 */

export class LaneRateLimiter {
	private laneNextAt: number[]
	private rr = 0

	/**
	 * Create a lane-based rate limiter
	 * @param lanes Number of concurrent lanes (threads)
	 * @param minDelayMs Minimum delay between requests per lane
	 */
	constructor(
		private readonly lanes: number,
		private readonly minDelayMs: number,
	) {
		this.laneNextAt = Array.from({ length: lanes }, () => 0)
	}

	/**
	 * Wait for the next available slot
	 * Uses round-robin lane selection for fair distribution
	 */
	async wait(): Promise<void> {
		const lane = this.rr++ % this.lanes
		const now = Date.now()
		const nextAt = this.laneNextAt[lane] ?? 0
		const waitMs = Math.max(0, nextAt - now)

		if (waitMs > 0) {
			await new Promise(resolve => setTimeout(resolve, waitMs))
		}

		this.laneNextAt[lane] = Date.now() + this.minDelayMs
	}

	/**
	 * Reset all lanes (useful for testing)
	 */
	reset(): void {
		this.laneNextAt = Array.from({ length: this.lanes }, () => 0)
		this.rr = 0
	}
}
