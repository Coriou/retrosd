/**
 * SearchView - ROM catalog search interface
 *
 * Provides a fast, filterable search experience for browsing the local catalog.
 * Supports text query, system/region filters, and pagination.
 *
 * @module ui/views/SearchView
 */
import { Box, Text, useApp, useInput } from "ink"
import { useState, useMemo } from "react"
import { useSearch } from "../hooks/useSearch.js"
import { Header, Section } from "../components/Header.js"
import { Spinner } from "../components/Spinner.js"
import { Success, Error as ErrorMsg, Warning } from "../components/Message.js"
import { colors, symbols } from "../theme.js"
import type { AppResult } from "../App.js"
import {
	collapseSearchResultsByHash,
	type SearchResult,
} from "../../db/queries/search.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchOptions {
	/** Path to database file */
	dbPath: string
	/** Target root directory (for downloads) */
	targetDir: string
	/** Initial search query */
	query?: string
	/** System filters */
	systems?: string[]
	/** Region filters */
	regions?: string[]
	/** Only show local ROMs */
	localOnly?: boolean
	/** Exclude pre-release ROMs */
	excludePrerelease?: boolean
	/** Collapse identical local ROMs by hash (requires scan --hashes) */
	collapseHash?: boolean
	/** Results per page */
	limit?: number
}

export interface SearchViewProps {
	options: SearchOptions
	onComplete?: ((result: AppResult) => void) | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
	if (bytes === null) return "—"
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function truncate(str: string | null, maxLen: number): string {
	if (!str) return "—"
	if (str.length <= maxLen) return str
	return str.slice(0, maxLen - 1) + "…"
}

function formatList(
	values: string[] | null | undefined,
	maxItems: number,
): string {
	if (!values || values.length === 0) return "—"
	return values.slice(0, maxItems).join(", ")
}

function formatFlags(result: SearchResult): string {
	const flags: string[] = []
	if (result.isBeta) flags.push("Beta")
	if (result.isDemo) flags.push("Demo")
	if (result.isProto) flags.push("Proto")
	if (result.isUnlicensed) flags.push("Unlicensed")
	if (result.isHack) flags.push("Hack")
	if (result.isHomebrew) flags.push("Homebrew")
	return flags.length > 0 ? flags.join(" · ") : "—"
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

interface ResultRowProps {
	result: SearchResult
	isSelected: boolean
}

function ResultRow({ result, isSelected }: ResultRowProps) {
	// Status indicator
	const statusIcon = result.isLocal ? (
		<Text color={colors.success}>{symbols.success}</Text>
	) : (
		<Text color={colors.muted}>{symbols.bullet}</Text>
	)

	const regionText = result.regions?.slice(0, 2).join(", ") ?? ""
	const languageText = result.languages?.slice(0, 2).join(", ") ?? ""
	const regionLangText =
		regionText && languageText
			? `${regionText} · ${languageText}`
			: regionText || languageText

	return (
		<Box gap={1}>
			{statusIcon}
			<Box width={8}>
				{isSelected ? (
					<Text bold color="black" backgroundColor={colors.primary}>
						{truncate(result.system, 8)}
					</Text>
				) : (
					<Text bold>{truncate(result.system, 8)}</Text>
				)}
			</Box>
			<Box width={39}>
				{isSelected ? (
					<Text color="black" backgroundColor={colors.primary}>
						{truncate(result.title ?? result.filename, 38)}
					</Text>
				) : (
					<Text>{truncate(result.title ?? result.filename, 38)}</Text>
				)}
			</Box>
			<Box width={16}>
				<Text color={colors.muted}>{truncate(regionLangText, 15)}</Text>
			</Box>
			<Box width={10}>
				<Text color={colors.muted}>{formatSize(result.size)}</Text>
			</Box>
			{result.isBeta && <Text color={colors.warning}>[β]</Text>}
			{result.isDemo && <Text color={colors.warning}>[Demo]</Text>}
			{result.isProto && <Text color={colors.warning}>[Proto]</Text>}
			{result.isUnlicensed && <Text color={colors.warning}>[Unl]</Text>}
			{result.isHack && <Text color={colors.warning}>[Hack]</Text>}
			{result.isHomebrew && <Text color={colors.warning}>[HB]</Text>}
		</Box>
	)
}

interface ResultDetailsProps {
	result: SearchResult
}

function ResultDetails({ result }: ResultDetailsProps) {
	return (
		<Box flexDirection="column" marginTop={1}>
			<Box gap={1}>
				<Text color={colors.muted}>File:</Text>
				<Text>{truncate(result.filename, 80)}</Text>
			</Box>
			<Box gap={2}>
				<Box gap={1}>
					<Text color={colors.muted}>Source:</Text>
					<Text>{result.source}</Text>
				</Box>
				<Box gap={1}>
					<Text color={colors.muted}>Regions:</Text>
					<Text>{formatList(result.regions, 4)}</Text>
				</Box>
				<Box gap={1}>
					<Text color={colors.muted}>Lang:</Text>
					<Text>{formatList(result.languages, 4)}</Text>
				</Box>
				<Box gap={1}>
					<Text color={colors.muted}>Rev:</Text>
					<Text>{result.revision ?? "—"}</Text>
				</Box>
			</Box>
			<Box gap={1}>
				<Text color={colors.muted}>Flags:</Text>
				<Text color={colors.warning}>{formatFlags(result)}</Text>
			</Box>
			{result.isLocal && result.localPath && (
				<Box gap={1}>
					<Text color={colors.muted}>Local:</Text>
					<Text color={colors.success}>{truncate(result.localPath, 80)}</Text>
				</Box>
			)}
		</Box>
	)
}

interface StatsBarProps {
	totalCount: number
	currentPage: number
	totalPages: number
	localCount: number
	isLoading: boolean
}

function StatsBar({
	totalCount,
	currentPage,
	totalPages,
	localCount,
	isLoading,
}: StatsBarProps) {
	return (
		<Box gap={2} marginY={1}>
			<Box>
				<Text color={colors.muted}>Found: </Text>
				<Text bold>{totalCount.toLocaleString()}</Text>
				<Text color={colors.muted}> ROMs</Text>
			</Box>
			{localCount > 0 && (
				<Box>
					<Text color={colors.muted}>(</Text>
					<Text color={colors.success}>{localCount}</Text>
					<Text color={colors.muted}> downloaded)</Text>
				</Box>
			)}
			<Box flexGrow={1} />
			{totalPages > 1 && (
				<Box>
					<Text color={colors.muted}>Page </Text>
					<Text>{currentPage + 1}</Text>
					<Text color={colors.muted}>/{totalPages}</Text>
				</Box>
			)}
			{isLoading && <Spinner />}
		</Box>
	)
}

interface FilterBarProps {
	systems: string[]
	regions: string[]
	localOnly: boolean
	excludePrerelease: boolean
}

function FilterBar({
	systems,
	regions,
	localOnly,
	excludePrerelease,
}: FilterBarProps) {
	const filters: string[] = []
	if (systems.length > 0) filters.push(`Systems: ${systems.join(", ")}`)
	if (regions.length > 0) filters.push(`Regions: ${regions.join(", ")}`)
	if (localOnly) filters.push("Local only")
	if (excludePrerelease) filters.push("No pre-release")

	if (filters.length === 0) return null

	return (
		<Box marginBottom={1}>
			<Text color={colors.info}>Filters: </Text>
			<Text color={colors.muted}>{filters.join(" | ")}</Text>
		</Box>
	)
}

interface HelpBarProps {
	query: string
}

function HelpBar({ query }: HelpBarProps) {
	return (
		<Box marginTop={1} gap={2}>
			<Text color={colors.muted}>↑/↓ Select</Text>
			<Text color={colors.muted}>←/→ Page</Text>
			<Text color={colors.muted}>Enter Download</Text>
			{query && <Text color={colors.muted}>Esc Clear</Text>}
			<Text color={colors.muted}>q Quit</Text>
		</Box>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function SearchView({ options, onComplete }: SearchViewProps) {
	const { exit } = useApp()

	// Initialize search hook
	const search = useSearch({
		dbPath: options.dbPath,
		...(options.query ? { initialQuery: options.query } : {}),
		...(options.systems ? { initialSystems: options.systems } : {}),
		pageSize: options.limit ?? 20,
	})
	const {
		results,
		totalCount,
		isLoading,
		error,
		stats,
		searchOptions,
		currentPage,
		totalPages,
		setQuery,
		nextPage,
		prevPage,
	} = search

	// Selection state
	const [selectedIndex, setSelectedIndex] = useState(0)

	const displayResults = useMemo(
		() =>
			options.collapseHash ? collapseSearchResultsByHash(results) : results,
		[options.collapseHash, results],
	)

	// Count local ROMs in current results
	const localCount = useMemo(
		() => displayResults.filter(r => r.isLocal).length,
		[displayResults],
	)

	const selectedResult = useMemo(
		() => displayResults[selectedIndex] ?? null,
		[displayResults, selectedIndex],
	)

	// Subtitle for header
	const headerSubtitle = stats
		? `${stats.totalRoms.toLocaleString()} ROMs in catalog`
		: "Loading catalog..."

	// Current query input (for display)
	const [queryInput, setQueryInput] = useState(options.query ?? "")
	const [toast, setToast] = useState<string | null>(null)

	// Handle keyboard input
	useInput((input, key) => {
		if (key.backspace || key.delete) {
			if (queryInput.length === 0) return
			const newQuery = queryInput.slice(0, -1)
			setQueryInput(newQuery)
			setQuery(newQuery)
			return
		}

		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(0, prev - 1))
		} else if (key.downArrow) {
			setSelectedIndex(prev => Math.min(displayResults.length - 1, prev + 1))
		} else if (key.leftArrow) {
			prevPage()
			setSelectedIndex(0)
		} else if (key.rightArrow) {
			nextPage()
			setSelectedIndex(0)
		} else if (key.escape) {
			if (queryInput) {
				setQueryInput("")
				setQuery("")
			}
		} else if (key.return) {
			const selected = displayResults[selectedIndex]
			if (!selected) return
			if (selected.isLocal) {
				setToast("Already downloaded")
				return
			}

			onComplete?.({
				success: true,
				completed: 0,
				failed: 0,
				durationMs: 0,
				nextAction: {
					type: "download",
					system: selected.system,
					source: selected.source,
					filename: selected.filename,
				},
			})
			exit()
		} else if (input === "q") {
			onComplete?.({
				success: true,
				completed: 0,
				failed: 0,
				durationMs: 0,
			})
			exit()
		} else if (input && !key.ctrl && !key.meta) {
			// Append to query (simple text input)
			if (input.length === 1) {
				const newQuery = queryInput + input
				setQueryInput(newQuery)
				setQuery(newQuery)
			}
		}
	})

	// Reset selection when results change
	useMemo(() => {
		if (selectedIndex >= displayResults.length) {
			setSelectedIndex(Math.max(0, displayResults.length - 1))
		}
	}, [displayResults.length, selectedIndex])

	return (
		<Box flexDirection="column">
			<Header subtitle={headerSubtitle}>ROM Search</Header>

			{toast && (
				<Box marginBottom={1}>
					<Success>{toast}</Success>
				</Box>
			)}

			{/* Search input display */}
			<Box marginBottom={1}>
				<Text color={colors.info}>🔍 </Text>
				<Text>
					{queryInput || <Text color={colors.muted}>Type to search…</Text>}
				</Text>
				{isLoading && <Spinner />}
			</Box>

			{/* Active filters */}
			<FilterBar
				systems={searchOptions.systems ?? []}
				regions={searchOptions.regions ?? []}
				localOnly={searchOptions.localOnly ?? false}
				excludePrerelease={searchOptions.excludePrerelease ?? false}
			/>

			{/* Error display */}
			{error && <ErrorMsg>{error}</ErrorMsg>}

			{/* Results list */}
			{displayResults.length > 0 ? (
				<Section title="Results">
					<StatsBar
						totalCount={totalCount}
						currentPage={currentPage}
						totalPages={totalPages}
						localCount={localCount}
						isLoading={isLoading}
					/>
					{displayResults.map((result, index) => (
						<ResultRow
							key={result.id}
							result={result}
							isSelected={index === selectedIndex}
						/>
					))}
					{selectedResult && <ResultDetails result={selectedResult} />}
				</Section>
			) : (
				!isLoading &&
				!error && (
					<Box marginY={1}>
						{queryInput ? (
							<Warning>No ROMs found matching "{queryInput}"</Warning>
						) : stats?.totalRoms === 0 ? (
							<Warning>
								Catalog is empty. Run 'retrosd sync' first to populate the
								database.
							</Warning>
						) : (
							<Text color={colors.muted}>
								Enter a search query to find ROMs
							</Text>
						)}
					</Box>
				)
			)}

			{/* Help bar */}
			<HelpBar query={queryInput} />
		</Box>
	)
}
