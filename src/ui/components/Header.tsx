/**
 * Header - Section headers with consistent styling
 * @module ui/components/Header
 */
import { Text, Box } from "ink"
import { colors, symbols } from "../theme.js"

export interface HeaderProps {
	/** Header text */
	children: React.ReactNode
	/** Optional subtitle/description */
	subtitle?: string
	/** Color of the header (default: primary) */
	color?: keyof typeof colors
}

export function Header({ children, subtitle, color = "primary" }: HeaderProps) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text bold color={colors[color]}>
				{symbols.arrow} {children}
			</Text>
			{subtitle && <Text color={colors.muted}> {subtitle}</Text>}
		</Box>
	)
}

export interface SectionProps {
	/** Section title */
	title: string
	/** Section content */
	children: React.ReactNode
}

export function Section({ title, children }: SectionProps) {
	return (
		<Box flexDirection="column" marginY={1}>
			<Header>{title}</Header>
			<Box marginLeft={2} flexDirection="column">
				{children}
			</Box>
		</Box>
	)
}
