/**
 * UiTest - Demo component to verify Ink installation and components
 * @module ui/views/UiTest
 */
import { Box, Text, render, useInput, useApp } from "ink"
import { useState, useEffect } from "react"
import { ProgressBar } from "../components/ProgressBar.js"
import { Spinner } from "../components/Spinner.js"
import { Success, Error, Warning, Info } from "../components/Message.js"
import { Header, Section } from "../components/Header.js"
import { colors, symbols } from "../theme.js"

function UiTest() {
	const { exit } = useApp()
	const [progress, setProgress] = useState(0)
	const [running, setRunning] = useState(true)

	useEffect(() => {
		const timer = setInterval(() => {
			setProgress(p => {
				const next = p + 0.02
				if (next >= 1) {
					clearInterval(timer)
					setRunning(false)
					// Exit after a brief pause to show completed state
					setTimeout(() => exit(), 500)
				}
				return Math.min(next, 1)
			})
		}, 50)

		return () => clearInterval(timer)
	}, [exit])

	useInput((input, key) => {
		if (input === "q" || key.escape) {
			exit()
		}
	})

	return (
		<Box flexDirection="column" padding={1}>
			<Header subtitle="Verifying Ink React installation">
				RetroSD UI Test
			</Header>

			<Section title="Message Components">
				<Success>Success message rendering correctly</Success>
				<Error>Error message with proper styling</Error>
				<Warning>Warning message with icon</Warning>
				<Info>Info message with theme colors</Info>
			</Section>

			<Section title="Progress Bar">
				<ProgressBar
					label={running ? "Downloading..." : "Complete!"}
					progress={progress}
					width={40}
					info={running ? `${Math.round(progress * 100)}%` : undefined}
				/>
			</Section>

			<Section title="Spinner">
				{running ? (
					<Spinner label="Processing items..." />
				) : (
					<Text color={colors.success}>{symbols.success} All done!</Text>
				)}
			</Section>

			<Box marginTop={1}>
				<Text color={colors.muted}>Press 'q' to exit</Text>
			</Box>
		</Box>
	)
}

export function runUiTest(): void {
	render(<UiTest />)
}
