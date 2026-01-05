# SQLite Integration: Local Catalog & Search

> **For AI Agents:** This is a multi-session implementation plan. Check the **Current Status** section first, then continue from the next uncompleted task. Update checkboxes as you complete items.

## Current Status

**Phase:** Phase 5 In Progress  
**Last Updated:** 2026-01-05  
**Blocking Issues:** None

**Notes:** Phase 4 scraper cache migration complete (SQLite-backed `GameCache` + one-time JSON import). Next: Phase 5 (Polish & Documentation).

---

## Overview

Add a local SQLite database to RetroSD to enable:

1. **Instant search** across all systems (~30K+ ROMs, sub-second queries)
2. **Offline catalog browsing** without network
3. **Smarter update detection** using local index

### Why SQLite

| Current State          | Problem                        | SQLite Solution                     |
| ---------------------- | ------------------------------ | ----------------------------------- |
| Fetch HTML per run     | 5-15s latency per search       | Sub-second queries on local index   |
| No cross-system search | Must fetch each system listing | Single `SELECT ... WHERE`           |
| JSON manifest          | Linear scan for changes        | Indexed `last_modified` comparisons |

### Architecture Decision

| Data                            | Storage         | Rationale                           |
| ------------------------------- | --------------- | ----------------------------------- |
| Remote catalog (Myrient mirror) | **SQLite**      | Fast queries, ~30K rows             |
| Parsed ROM metadata             | **SQLite**      | Enables filtered search             |
| Local collection tracking       | **SQLite**      | Join with remote catalog            |
| Scraper cache                   | **SQLite**      | Move from existing JSON             |
| User preferences                | **JSON** (keep) | Simple, per-target, portable        |
| Global config                   | **JSON** (keep) | `.retrosdrc` pattern                |
| ROM sidecars                    | **JSON** (keep) | Portable, per-file, tool-compatible |

---

## Phase 1: Foundation ✅

**Goal:** Add dependencies, schema, connection manager, migrations.

### Tasks

- [x] **1.1** Install dependencies

  ```bash
  npm install better-sqlite3 drizzle-orm
  npm install -D drizzle-kit @types/better-sqlite3
  ```

- [x] **1.2** Create drizzle config: `drizzle.config.ts`

  ```typescript
  import { defineConfig } from "drizzle-kit"
  export default defineConfig({
  	schema: "./src/db/schema.ts",
  	out: "./drizzle",
  	dialect: "sqlite",
  })
  ```

- [x] **1.3** Create schema: `src/db/schema.ts`

  ```typescript
  import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

  export const remoteRoms = sqliteTable(
  	"remote_roms",
  	{
  		id: integer("id").primaryKey({ autoIncrement: true }),
  		system: text("system").notNull(),
  		source: text("source").notNull(),
  		filename: text("filename").notNull(),
  		size: integer("size"),
  		lastModified: text("last_modified"),
  		lastSyncedAt: text("last_synced_at"),
  	},
  	table => ({
  		systemIdx: index("idx_system").on(table.system),
  		filenameIdx: index("idx_filename").on(table.filename),
  	}),
  )

  export const romMetadata = sqliteTable(
  	"rom_metadata",
  	{
  		id: integer("id").primaryKey({ autoIncrement: true }),
  		remoteRomId: integer("remote_rom_id").references(() => remoteRoms.id),
  		title: text("title"),
  		regions: text("regions"), // JSON array
  		languages: text("languages"), // JSON array
  		revision: integer("revision"),
  		isBeta: integer("is_beta", { mode: "boolean" }),
  		isDemo: integer("is_demo", { mode: "boolean" }),
  		isUnlicensed: integer("is_unlicensed", { mode: "boolean" }),
  		isHomebrew: integer("is_homebrew", { mode: "boolean" }),
  		isHack: integer("is_hack", { mode: "boolean" }),
  	},
  	table => ({
  		titleIdx: index("idx_title").on(table.title),
  		remoteRomIdx: index("idx_remote_rom").on(table.remoteRomId),
  	}),
  )

  export const localRoms = sqliteTable("local_roms", {
  	id: integer("id").primaryKey({ autoIncrement: true }),
  	remoteRomId: integer("remote_rom_id").references(() => remoteRoms.id),
  	localPath: text("local_path"),
  	sha1: text("sha1"),
  	crc32: text("crc32"),
  	fileSize: integer("file_size"),
  	downloadedAt: text("downloaded_at"),
  	verifiedAt: text("verified_at"),
  })

  export const scraperCache = sqliteTable("scraper_cache", {
  	id: integer("id").primaryKey({ autoIncrement: true }),
  	cacheKey: text("cache_key").unique(),
  	gameId: integer("game_id"),
  	gameName: text("game_name"),
  	mediaUrls: text("media_urls"), // JSON
  	scrapedAt: text("scraped_at"),
  })

  export const syncState = sqliteTable("sync_state", {
  	system: text("system").primaryKey(),
  	source: text("source"),
  	remoteLastModified: text("remote_last_modified"),
  	localLastSynced: text("local_last_synced"),
  })
  ```

- [x] **1.4** Create connection manager: `src/db/index.ts`

  ```typescript
  import Database from "better-sqlite3"
  import { drizzle } from "drizzle-orm/better-sqlite3"
  import * as schema from "./schema.js"

  let db: ReturnType<typeof drizzle> | null = null
  let sqlite: Database.Database | null = null

  export function getDb(dbPath: string) {
  	if (!db) {
  		sqlite = new Database(dbPath)
  		sqlite.pragma("journal_mode = WAL")
  		db = drizzle(sqlite, { schema })
  	}
  	return db
  }

  export function closeDb() {
  	sqlite?.close()
  	db = null
  	sqlite = null
  }
  ```

- [x] **1.5** Add migration scripts to `package.json`

  ```json
  {
  	"scripts": {
  		"db:generate": "drizzle-kit generate",
  		"db:migrate": "drizzle-kit migrate",
  		"db:studio": "drizzle-kit studio"
  	}
  }
  ```

- [x] **1.6** Generate initial migration

  ```bash
  npm run db:generate
  ```

- [x] **1.7** Create migration runner: `src/db/migrate.ts`

### Verification

```bash
npm run build     # TypeScript compiles
npm run db:generate  # Migration generated
npm run check     # Lints pass
```

---

## Phase 2: Catalog Sync

**Goal:** Sync Myrient listings to local database.

### Tasks

- [x] **2.1** Create sync generator: `src/core/catalog-sync.ts`
  - Async generator yielding sync events
  - Use existing `parseListing()` and `parseRomName()`
  - Batch inserts in transactions

- [x] **2.2** Add `retrosd sync` command
  - Syncs selected systems (or all)
  - Shows progress via Ink UI
  - Records `sync_state` timestamps

- [x] **2.3** Implement incremental sync (integrated in 2.1)
  - Compare `sync_state.remoteLastModified` with directory listing
  - Skip unchanged systems

- [x] **2.4** Hook into download flow
  - After download, update `local_roms` table
  - Keep existing JSON sidecar generation

### Verification

```bash
retrosd sync --systems=GB    # Syncs GB catalog
retrosd sync                 # Syncs all known systems
sqlite3 .retrosd.db "SELECT COUNT(*) FROM remote_roms"
```

---

## Phase 3: Search Command

**Goal:** Implement fast local search with Ink UI.

### Tasks

- [x] **3.1** Create search queries: `src/db/queries/search.ts`

  ```typescript
  interface SearchOptions {
  	query?: string
  	systems?: string[]
  	regions?: string[]
  	excludePrerelease?: boolean
  	localOnly?: boolean
  	limit?: number
  	offset?: number
  }
  ```

- [x] **3.2** Add `retrosd search` CLI command
  - Basic table output for non-interactive mode
  - Uses existing parsed metadata

- [x] **3.3** Create `SearchView.tsx` Ink component
  - Text input for query
  - System/region filter toggles
  - Results list with pagination
  - "Download selected" action (placeholder)

- [x] **3.4** Add `--interactive` / `-i` flag for fuzzy search mode

### Verification

```bash
retrosd search "mario"                    # Table output
retrosd search "zelda" --systems=GB,GBA   # Filtered
retrosd search --local "pokemon"          # Only downloaded
retrosd search -i                         # Interactive mode
```

---

## Phase 4: Scraper Cache Migration

**Goal:** Move scraper cache from JSON to SQLite.

### Tasks

- [x] **4.1** Update `GameCache` class to use SQLite
  - Keep same public API
  - Migrate existing JSON on first run

- [x] **4.2** Add migration logic for existing `.retrosd-scrape-cache.json`
  - Detect old cache file (supports both `.retrosd-scrape-cache.json` and legacy `.screenscraper-cache.json`)
  - Import into `scraper_cache` table
  - Rename/archive old file

### Verification

```bash
retrosd scrape --systems=GB /path/to/sdcard  # Uses SQLite cache
sqlite3 .retrosd.db "SELECT COUNT(*) FROM scraper_cache"
```

---

## Phase 5: Polish & Documentation

**Goal:** Finalize, test, document.

### Tasks

- [x] **5.1** Add database stats to `retrosd scan`
  - Show catalog sync status
  - Show search index stats

- [x] **5.2** Update README with new commands
  - `retrosd sync`
  - `retrosd search`

- [x] **5.3** Add `--db-path` global option for custom DB location

- [x] **5.4** Integration tests for sync/search flow

- [x] **5.5** Auto-run migrations on DB connect
  - Prevents runtime SQL errors when the DB exists but is behind the code schema (e.g. new columns like `local_roms.filename`).

- [x] **5.6** Fix remote catalog path mappings (sync 404s)
  - Updated `FC_CART` and `MD_SEGA_CD` Myrient directory mappings to valid paths.

- [x] **5.7** Reconcile pre-existing ROMs into `local_roms`
  - `retrosd scan` now upserts scanned files into `local_roms` so search correctly marks already-present files as local, even if they were copied onto the SD card outside of RetroSD.

---

## Technical Reference

### Database Location

Default: `.retrosd.db` in target directory (same location as `.retrosd-manifest.json`)

This keeps the database portable with the collection.

### Directory Structure (Final)

```
src/
├── db/
│   ├── index.ts          # Connection manager
│   ├── schema.ts         # Drizzle schema
│   ├── migrate.ts        # Migration runner
│   └── queries/
│       ├── search.ts     # Search queries
│       └── sync.ts       # Sync queries
├── core/
│   ├── catalog-sync.ts   # Sync generator
│   ├── downloader.ts     # (existing)
│   └── scraper/          # (existing)
├── ui/
│   └── views/
│       └── SearchView.tsx
└── cli/
    └── index.ts          # (add sync, search commands)
```

### Key Dependencies

```json
{
	"dependencies": {
		"better-sqlite3": "^11.x",
		"drizzle-orm": "^0.40.x"
	},
	"devDependencies": {
		"drizzle-kit": "^0.30.x",
		"@types/better-sqlite3": "^7.x"
	}
}
```

---

## Design Decisions

### Q: Database location?

**A:** Target directory (`.retrosd.db`) - portable with collection.

### Q: Sync strategy?

**A:** Lazy (only systems user interacts with) by default, with `retrosd sync --all` for eager.

### Q: Search UI?

**A:** Both table output (default) and interactive Ink mode (`-i` flag).

### Q: Freshness/TTL?

**A:** On-demand via `retrosd sync`. Show "last synced" in search output. Suggest sync if >7 days old.

---

## Notes

- Keep existing JSON manifest for download resume (different purpose than catalog)
- ROM sidecars remain JSON for portability with other tools
- If phase takes longer than expected, split into sub-phases
- Each phase should leave codebase in working state
