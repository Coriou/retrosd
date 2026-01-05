/**
 * Spinner - Animated loading indicator
 * @module ui/components/Spinner
 */
import { Text } from "ink"
import InkSpinner from "ink-spinner"
import { colors } from "../theme.js"

export interface SpinnerProps {
	/** Text to display next to the spinner */
	label?: string
	/** Color of the spinner */
	color?: keyof typeof colors
}

export function Spinner({ label, color = "accent" }: SpinnerProps) {
	return (
		<Text>
			<Text color={colors[color]}>
				<InkSpinner type="dots" />
			</Text>
			{label && <Text> {label}</Text>}
		</Text>
	)
}
