/**
 * UI Theme - Consistent design tokens for Ink components
 * @module ui/theme
 */

/** Color palette optimized for terminal output */
export const colors = {
	success: "green",
	error: "red",
	warning: "yellow",
	info: "blue",
	muted: "gray",
	accent: "cyan",
	primary: "magenta",
} as const

/** Unicode symbols for status indicators */
export const symbols = {
	success: "✓",
	error: "✗",
	warning: "⚠",
	info: "ℹ",
	bullet: "•",
	arrow: "→",
	ellipsis: "…",
	download: "⬇",
	hourglass: "⏳",
} as const

/** Progress bar characters */
export const progressChars = {
	filled: "█",
	empty: "░",
	partial: ["▏", "▎", "▍", "▌", "▋", "▊", "▉"],
} as const

/** Animation frames for spinners */
export const spinnerFrames = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
] as const

export type Color = (typeof colors)[keyof typeof colors]
export type Symbol = (typeof symbols)[keyof typeof symbols]
