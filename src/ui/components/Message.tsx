/**
 * Message - Styled status messages (success, error, warning, info)
 * @module ui/components/Message
 */
import { Text, Box } from "ink"
import { colors, symbols } from "../theme.js"

export type MessageType = "success" | "error" | "warning" | "info"

export interface MessageProps {
	/** Type determines color and icon */
	type: MessageType
	/** The message text */
	children: React.ReactNode
	/** Whether to show the status icon (default: true) */
	showIcon?: boolean
}

const typeConfig: Record<
	MessageType,
	{ color: keyof typeof colors; symbol: string }
> = {
	success: { color: "success", symbol: symbols.success },
	error: { color: "error", symbol: symbols.error },
	warning: { color: "warning", symbol: symbols.warning },
	info: { color: "info", symbol: symbols.info },
}

export function Message({ type, children, showIcon = true }: MessageProps) {
	const { color, symbol } = typeConfig[type]

	return (
		<Box gap={1}>
			{showIcon && <Text color={colors[color]}>{symbol}</Text>}
			<Text color={colors[color]}>{children}</Text>
		</Box>
	)
}

/** Shorthand components for common message types */
export function Success({ children }: { children: React.ReactNode }) {
	return <Message type="success">{children}</Message>
}

export function Error({ children }: { children: React.ReactNode }) {
	return <Message type="error">{children}</Message>
}

export function Warning({ children }: { children: React.ReactNode }) {
	return <Message type="warning">{children}</Message>
}

export function Info({ children }: { children: React.ReactNode }) {
	return <Message type="info">{children}</Message>
}
