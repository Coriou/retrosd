# Testing Guide

This document describes the testing strategy and how to run tests for RetroSD.

## Quick Start

```bash
# Run all unit tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run contract tests (manual, before releases)
npm run test:contract

# Run in CI mode (minimal output, with coverage)
npm run test:ci
```

## Test Organization

```
test/
├── unit/                    # Unit tests for individual modules
│   ├── romname.test.ts      # ROM filename parsing
│   ├── filters.test.ts      # 1G1R filtering and region priority
│   ├── hash.test.ts         # SHA-1/CRC32 computation
│   ├── extract.test.ts      # ZIP extraction
│   └── loadFilterList.test.ts # File-based filter lists
├── contract/                # Contract tests (manual-only)
│   ├── bios.test.ts         # BIOS URL reachability
│   ├── myrient.test.ts      # ROM catalog format
│   └── screenscraper.test.ts # API response structure
├── fixtures/                # Test data files
│   ├── rom-filenames.json   # 400 real ROM filenames
│   ├── catalog-stats.json   # Catalog statistics
│   └── scraper-responses/   # API response samples
├── helpers/                 # Test utilities
│   ├── index.ts             # withTempDir, withTempDb, URL checking
│   └── setup.ts             # Vitest setup (logger suppression)
├── scan-*.test.ts           # Integration tests for scan functionality
└── sqlite-*.test.ts         # Integration tests for SQLite operations
```

## Test Categories

### Unit Tests

Fast, isolated tests that don't require network access or real databases.

**Run:** `npm test`

**Coverage targets:**

- `src/hash.ts` - 90% statements (critical for ROM verification)
- `src/romname.ts` - 80% statements (core parsing logic)
- `src/filters.ts` - 70% statements (1G1R selection)

### Integration Tests

Tests that exercise multiple modules together with real (temporary) databases.

**Examples:**

- `scan-hash-incremental.test.ts` - Tests incremental hashing with metadata
- `sqlite-sync-search.test.ts` - Tests DB sync and search queries

### Contract Tests

Tests that verify external dependencies (URLs, APIs) haven't changed.

**Run:** `npm run test:contract`

> [!IMPORTANT]
> Contract tests make live network requests. Run them manually before releases, not in CI, to avoid rate limiting and flaky failures.

**What they check:**

- BIOS download URLs are reachable
- Myrient directory listing format hasn't changed
- ScreenScraper API response structure is stable

## Writing Tests

### Use Real Data

Tests should use realistic ROM filenames from the fixtures:

```typescript
import romFilenames from "../fixtures/rom-filenames.json" with { type: "json" }

it.each(romFilenames.samples.slice(0, 20))("parses %s correctly", sample => {
	const result = parseRomFilenameParts(sample.filename)
	expect(result.title).toBeDefined()
})
```

### Use Test Helpers

For database tests, use the helpers:

```typescript
import { withTempDb } from "./helpers/index.js"

it("inserts and queries data", async () => {
	await withTempDb(async (db, dbPath) => {
		// db is a ready-to-use DbClient
		// dbPath is the path to the temp database
		// Cleanup is automatic
	})
})
```

### Snapshot Testing

Use snapshots to detect unexpected changes in:

- Parsed ROM names
- Configuration exports (BIOS entries, ROM entries)
- API response patterns

```typescript
it("parses complex filename consistently", () => {
	const result = parseRomFilenameParts("Game (Europe) (En,Fr,De) (Rev 2).gba")
	expect(result).toMatchSnapshot()
})
```

Update snapshots when behavior intentionally changes:

```bash
npm test -- --update-snapshots
```

## Updating Fixtures

The `rom-filenames.json` fixture is exported from a real database:

```bash
npx tsx scripts/export-test-fixtures.ts _card/.retrosd.db
```

This extracts:

- 400 diverse ROM filenames (betas, multi-region, revisions, etc.)
- Scraper cache samples
- Catalog statistics

## CI Integration

The CI workflow runs on GitHub Actions with multiple parallel jobs for fast feedback:

### Workflow Jobs

| Job                  | Trigger           | Purpose                           |
| -------------------- | ----------------- | --------------------------------- |
| **Lint & Typecheck** | All pushes/PRs    | Fast static analysis (~30s)       |
| **Unit Tests**       | All pushes/PRs    | Run tests without coverage (~45s) |
| **Build**            | After checks pass | Verify compilation                |
| **Test Coverage**    | Main branch only  | Full coverage with thresholds     |

### Available Scripts

```bash
# Fast tests (no coverage) - used in CI for PRs
npm run test:ci-fast

# Full tests with coverage - used locally
npm run test:ci

# Coverage that reports even on failure - used on main branch
npm run test:ci-coverage
```

### Coverage Thresholds

Critical modules have enforced coverage thresholds:

| Module          | Statements | Branches |
| --------------- | ---------- | -------- |
| `hash.ts`       | 95%        | 90%      |
| `romname.ts`    | 85%        | 60%      |
| `filters.ts`    | 75%        | 55%      |
| `extract.ts`    | 55%        | -        |
| `scan/stats.ts` | 90%        | -        |

> [!NOTE]
> Contract tests are excluded from CI to avoid flaky network-dependent failures.
> Run them manually before releases: `npm run test:contract`

## Debugging Tests

### Run a Single Test

```bash
npm test -- --filter "parses Rev 1 format"
```

### Run Tests in a File

```bash
npm test -- test/unit/romname.test.ts
```

### Verbose Output

```bash
npm test -- --reporter=verbose
```

### Debug Mode

```bash
DEBUG=true npm test
```
