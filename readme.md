# RetroSD

A comprehensive **ROM library manager** for retro gaming consoles with DAT-style verification, metadata generation, smart filtering, and artwork scraping. Download, organize, verify, and enhance your ROM collection with a single powerful tool.

## ✨ Features

### 1. Download & Organize ROMs ✅

**What it does:**

- Downloads ROMs from curated sources (No-Intro, Redump)
- Automatically organizes into system-specific directories
- Supports multiple sources and systems simultaneously
- Smart resume for interrupted downloads

**Why it matters:**

- Single command to build your entire collection
- No manual searching or downloading individual files
- Reliable sources ensure authentic ROMs

---

### 2. Smart 1G1R (One-Game-One-ROM) Filtering ✅

**What it does:**

- Automatically selects the best version of each game when multiple regional variants exist
- Uses intelligent region priority scoring (Europe > USA > World > Japan...)
- Prefers newer revisions (Rev 3 > Rev 2 > Rev 1) and keeps multi-disc sets intact

**Why it matters:**

- Keeps your library clean and manageable
- No duplicate games cluttering your collection
- Still configurable with `--no-1g1r` if you want all variants

**Example:**
Instead of downloading:

- Super Mario Bros. (USA).nes
- Super Mario Bros. (Europe).nes
- Super Mario Bros. (Japan).nes
- Super Mario Bros. (World).nes

You get just: `Super Mario Bros. (Europe).nes` (the highest priority version)

---

### 3. Metadata Generation & DAT Compatibility ✅

**What it does:**

- Creates `.json` sidecar files for every ROM
- Parses filename to extract: title, region, version, tags
- Can generate SHA-1 and CRC32 hashes (compatible with No-Intro/Redump DATs)
- Tracks file size and timestamps

**Why it matters:**

- Makes your collection compatible with ROM managers like RomVault, clrmamepro, igir
- Enables integration with RomM, Playnite, EmulationStation
- Provides data for scrapers to work more accurately
- Allows verification of ROM integrity over time

**Notes:**

- Hashes are computed when you opt in:
  - During download with `--verify-hashes`
  - During scanning with `retrosd scan --hashes`

**Metadata file example:**

```json
{
	"title": "Pokemon Red",
	"filename": "Pokemon Red (USA)",
	"fullFilename": "Pokemon Red (USA).gb",
	"system": "GB",
	"region": ["USA"],
	"tags": [],
	"source": "no-intro",
	"hash": {
		"sha1": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
		"crc32": "3d45c1ee",
		"size": 1048576
	},
	"createdAt": "2026-01-02T10:30:00.000Z",
	"updatedAt": "2026-01-02T10:30:00.000Z"
}
```

---

### 4. Collection Scanning & Verification ✅

**Commands:**

#### `retrosd scan`

Catalog your entire ROM collection:

```bash
retrosd scan /path/to/sdcard
# Output:
# GB: 1660 ROMs (368.8 MB)
# GBA: 2662 ROMs (21.6 GB)
# GBC: 1467 ROMs (2.1 GB)
# Total: 5789 ROMs across 3 systems (24.0 GB)

# With hashing for verification:
retrosd scan --hashes -o collection.json /path/to/sdcard
```

When hashes are available, the scan summary also reports how many **byte-identical duplicates** it found (grouped by SHA-1 when present, otherwise CRC32).

#### `retrosd verify`

Verify ROM integrity against stored hashes:

```bash
retrosd verify /path/to/sdcard
# Checks SHA-1/CRC32 against metadata
# Reports corrupted or modified files
```

**Why it matters:**

- Know exactly what's in your collection
- Detect bit rot or file corruption early
- Validate after copying to new storage
- Generate manifests for other tools

---

### 5. Local Catalog Sync & Search ✅

**What it does:**

- Builds a local SQLite index of remote catalogs for fast, offline queries
- Provides instant search across systems (title/filename, system/region filters)
- Tracks catalog freshness and local download status in the database

**Why it matters:**

- Sub-second searches without re-fetching listings each run
- Works offline once synced
- Enables `--local` queries to show what you have downloaded

**Usage:**

```bash
# Efficient periodic refresh (remote catalog + local ROM presence)
retrosd sync-db /path/to/sdcard

# Build/update the local catalog database (stored in the target by default)
retrosd sync /path/to/sdcard

# Search the local catalog
retrosd search /path/to/sdcard mario

# Interactive search UI
retrosd search /path/to/sdcard -i

# Filter by system/region and show only downloaded ROMs
retrosd search /path/to/sdcard zelda --systems=GB,GBA --regions=USA,Europe --local

# Collapse identical local results by hash (requires `retrosd scan --hashes`)
retrosd search /path/to/sdcard 102 --systems=GBC --collapse-hash

# Custom DB location (absolute path or relative to the target)
retrosd sync /path/to/sdcard --db-path .retrosd/catalog.db
retrosd search /path/to/sdcard pokemon --db-path .retrosd/catalog.db

# For cron/automation (minimal output)
npm run sync-db -- /path/to/sdcard --quiet
```

**Database location:**

- Default: `.retrosd.db` at the SD card root (same directory as `Bios/` and `Roms/`)
- Override: `--db-path <path>` (relative paths are resolved from the target)

---

### 6. Maintenance: Tidy (Keep Everything Tidy) ✅

**What it does:**

- Refreshes the database (remote catalogs + local ROM presence)
- Optionally generates missing metadata sidecars (or refreshes all)
- Optionally scrapes artwork from ScreenScraper
- Designed for periodic maintenance runs without unnecessary writes by default

**Why it matters:**

- Single command for comprehensive maintenance
- Default behavior is safe: no unwanted rewrites, no API calls without opt-in
- Can scope to specific systems to reduce runtime
- Keeps your library metadata current and complete

**Usage:**

```bash
# Minimal maintenance: just refresh database (fast, safe)
retrosd tidy /path/to/sdcard

# With metadata generation (missing only, no overwrites)
retrosd tidy /path/to/sdcard --metadata

# Refresh metadata for all ROMs (including existing files)
retrosd tidy /path/to/sdcard --metadata --metadata-mode refresh

# Include hashes (slow, but enables integrity checking)
retrosd tidy /path/to/sdcard --metadata --with-hashes

# Scope to specific systems (faster for targeted maintenance)
retrosd tidy /path/to/sdcard --systems=GB,GBA --metadata

# Enable artwork scraping (requires ScreenScraper credentials)
retrosd tidy /path/to/sdcard --scrape --username=me --password=secret

# Full maintenance: DB + metadata + scraping
retrosd tidy /path/to/sdcard --metadata --scrape --username=me --password=secret

# Include disc compression (convert eligible disc images to CHD; requires chdman)
retrosd tidy /path/to/sdcard --compress --metadata

# Delete originals after successful conversion (use with care)
retrosd tidy /path/to/sdcard --compress --compress-delete-originals

# NPM script version
npm run tidy -- /path/to/sdcard --quiet

# Strict mode: exit with error code if any stage fails
retrosd tidy /path/to/sdcard --metadata --scrape --strict
```

**Options:**

- `--systems <list>`: Comma-separated system keys to process
- `--force`: Force full remote resync, ignoring timestamps
- `--compress`: Convert eligible disc images to CHD (requires `chdman`)
- `--compress-delete-originals`: Delete original disc files after successful conversion (requires `--compress`)
- `--metadata`: Enable metadata generation stage
- `--metadata-mode <mode>`: `missing` (default) or `refresh`
- `--with-hashes`: Generate SHA-1/CRC32 hashes (slow, opt-in)
- `--scrape`: Enable artwork scraping
- `--scrape-mode <mode>`: `missing` (default) or `refresh`
- `--scrape-media <list>`: `box,screenshot,video` (comma-separated)
- `--username`, `--password`: ScreenScraper credentials
- `--dev-id`, `--dev-password`: ScreenScraper developer credentials
- `--strict`: Exit with error code if any stage fails
- `-q, --quiet`: Minimal output
- `--verbose`: Detailed per-system output

**Default behavior:**

- DB refresh: always runs first (same as `retrosd sync-db`)
- Metadata: disabled by default (use `--metadata` to enable)
- Scraping: disabled by default (use `--scrape` to enable)
- Metadata mode: `missing` (skips existing sidecars without overwriting)
- Scrape mode: `missing` (skips existing media files)
- Error handling: best-effort (metadata/scrape failures don't block, unless `--strict`)

---

### 7. Format Conversion (CHD) ✅

**What it does:**

- Converts disc images (CUE/BIN) to CHD format
- Uses MAME's chdman for compression
- Optionally deletes originals to save space

**Why it matters:**

- **Massive space savings:** PS1 games go from ~700MB to ~200-300MB (60-70% reduction)
- CHD is widely supported by RetroArch, EmulationStation, etc.
- Preserves perfect quality (lossless compression)

**Usage:**

```bash
# Convert during download
# (Default: if chdman is installed and you download disc systems, RetroSD will offer/enable CHD conversion)
retrosd --systems=PS /path/to/sdcard

# Force enable/disable
retrosd --convert-chd --systems=PS /path/to/sdcard
retrosd --no-convert-chd --systems=PS /path/to/sdcard

# Convert existing collection
retrosd convert /path/to/sdcard --delete-originals
```

**Requirements:**

- macOS: `brew install rom-tools`
- Linux: `apt-get install mame-tools`

**Redump archives:**

- Many disc catalogs ship as `.7z`. To extract those automatically:
  - macOS: `brew install p7zip`
  - Linux: `apt-get install p7zip-full`

---

### 7. Collection Export ✅

**What it does:**

- Generates JSON manifest of entire collection
- Includes hashes, metadata, statistics
- Compatible with RomM, Playnite, custom tools

**Usage:**

```bash
retrosd export /path/to/sdcard -o collection.json
```

**Use cases:**

- Import into RomM for web-based library browsing
- Bulk import into Playnite
- Generate EmulationStation gamelists
- Track collection over time

---

### 8. Artwork & Media Scraping ✅

**What it does:**

- Downloads box art, screenshots, videos from ScreenScraper
- Generates EmulationStation-compatible gamelists
- Supports multiple media types and regions
- Intelligent caching to avoid redundant API calls
- **Can be chained** with the main download command

**Why it matters:**

- Beautiful visual frontend experience
- No manual artwork hunting
- EmulationStation-ready out of the box
- Respects ScreenScraper rate limits with smart threading

**Usage:**

```bash
# Standalone scraping
retrosd scrape /path/to/sdcard --systems=GB

# Chain with download (Download -> Organize -> Scrape)
retrosd --systems=GB --preset=english --scrape /path/to/sdcard

# With credentials (can also be stored in config file)
retrosd --systems=GB --scrape \
  --username user --password pass \
  /path/to/sdcard

# Select specific media types
retrosd scrape /path/to/sdcard --systems=GB \
	--screenshot --video

# (Main command) Select specific media types when chaining
retrosd --systems=GB --scrape --scrape-media box,screenshot,video /path/to/sdcard
```

**Supported systems:**
All major systems including GB, GBA, GBC, NES, SNES, Genesis, PS1, and more.

---

### 9. Metadata Generation Command ✅

**What it does:**

- Generates metadata for existing ROM collections
- Computes SHA-1/CRC32 hashes for verification
- Can update or recreate metadata files

**Usage:**

```bash
# Generate metadata for all ROMs
retrosd metadata /path/to/sdcard

# Only for specific systems
retrosd metadata /path/to/sdcard --systems=GB,GBA

# With hash computation
retrosd metadata /path/to/sdcard --with-hashes

# Overwrite existing metadata
retrosd metadata /path/to/sdcard --overwrite
```

---

## 🔧 Download & Filtering Options

### Advanced Filtering

RetroSD provides flexible filtering to customize your collection:

- **Region priority** (EU-first by default) considers region and revision info
- **Language priority** refines 1G1R when regions tie
- **Exclusion filters** work alongside 1G1R for precise control
- **Wildcard include/exclude patterns** for quick, targeted filtering
- **Custom regex** patterns for power users with specific needs
- **Presets** for common preferences (usa, english, ntsc, pal, japanese, all)

#### Content Exclusion Filters

By default, RetroSD filters out pre-release, unlicensed, hacked, and homebrew content to maintain a clean, official game collection:

**`--include-prerelease`** - Include pre-release versions (excluded by default)

- **Includes:** Beta, Demo, Proto, Sample, Preview versions
- **Example:** `Pokemon Gold (USA) (Beta).gb`
- **Use case:** Collectors who want development/prototype ROMs

**`--include-unlicensed`** - Include unlicensed/pirate versions (excluded by default)

- **Includes:** Unlicensed (Unl), Pirate, Bootleg releases
- **Example:** `Super Mario 4 (Pirate).gb`
- **Use case:** Preservation or testing unofficial releases

**`--include-hacks`** - Include hacked ROMs (excluded by default)

- **Includes:** Hack, Hacked, Romhack variants
- **Example:** `Metroid (USA) (Hack).nes`
- **Use case:** ROM hack collections or fan patches

**`--include-homebrew`** - Include homebrew ROMs (excluded by default)

- **Includes:** Homebrew releases
- **Example:** `Micro Mages (Homebrew).nes`
- **Use case:** Indie/homebrew collections

**Combine flags** to include everything, or use none for curated official releases only.

```bash
# Default: official releases only (no betas, no pirates)
retrosd --systems=GB /path/to/sdcard

# Include beta/demo versions
retrosd --systems=GB --include-prerelease /path/to/sdcard

# Include everything (official + prerelease + unlicensed + hacks + homebrew)
retrosd --systems=GB --include-prerelease --include-unlicensed \
  --include-hacks --include-homebrew /path/to/sdcard
```

#### Pattern and List Filters

**`--include-pattern` / `--exclude-pattern`** - Wildcard filtering (`*` matches any text)

```bash
# Only include titles starting with "Super"
retrosd --systems=SNES --include-pattern "Super*" /path/to/sdcard

# Exclude BIOS and beta files
retrosd --systems=SNES --exclude-pattern "*[BIOS]*,*Beta*" /path/to/sdcard
```

**`--include-from` / `--exclude-from`** - Include/exclude from a file (one filename per line)

```bash
retrosd --systems=SNES --include-from ./include.txt /path/to/sdcard
retrosd --systems=SNES --exclude-from ./exclude.txt /path/to/sdcard
```

#### Region and Language Priority

**`--region` / `--region-priority`** - Prefer regions for 1G1R selection

```bash
# Prefer Japan for a single run
retrosd --systems=GB --region jp /path/to/sdcard

# Override the entire region priority list
retrosd --systems=GB --region-priority "eu,us,wor,jp" /path/to/sdcard
```

**`--lang` / `--lang-priority`** - Prefer languages when regions tie

```bash
retrosd --systems=GB --lang en /path/to/sdcard
retrosd --systems=GB --lang-priority "en,fr,de" /path/to/sdcard
```

**`--lang-scope`** - Control how `--lang` is applied

- `prefer` (default): `--lang` is a tie-breaker for 1G1R selection.
- `strict`: only keep ROMs matching that language.
- `fallback`: keep that language when available, otherwise fall back to English (`en`).

```bash
# French-only pool (still applies 1G1R among remaining candidates)
retrosd --systems=GB --lang fr --lang-scope strict /path/to/sdcard

# French preferred, but allow English fallback
retrosd --systems=GB --lang fr --lang-scope fallback /path/to/sdcard
```

**Language inference (enabled by default):** when a ROM filename has no explicit language tags,
RetroSD can infer language from unambiguous region codes (e.g. `USA` -> `en`, `France` -> `fr`).
Disable this if you want only explicitly-tagged language matches:

```bash
retrosd --systems=GB --lang fr --lang-scope strict --no-lang-infer /path/to/sdcard
```

##### Recipe: “EU French → EU English → USA” (FR → EN → US)

If you want the exact fallback chain:

- Prefer **Europe** releases when available
- Within Europe, prefer **French** when available
- Otherwise, fall back to **English**
- If no Europe release exists, fall back to **USA**

Use 1G1R region + language priority (do **not** rely on the `pal` preset for this, since it whitelists many European country variants and can pull in ES/IT/DE, etc.).

```bash
# Recommended: whitelist the language pool and apply EU -> US fallback
retrosd --systems=GB --preset=all --region-priority "eu,us" --lang fr --lang-scope fallback /path/to/sdcard

# Equivalent (explicit): order the full language priority list + fallback pool
retrosd --systems=GB --preset=all --region-priority "eu,us" --lang fr --lang-scope fallback --lang-priority "fr,en" /path/to/sdcard
```

This scales to other languages the same way:

```bash
# EU Italian -> EU English -> USA
retrosd --systems=GB --preset=all --region-priority "eu,us" --lang it --lang-scope fallback /path/to/sdcard
```

### Download Features

- **Metadata generation** happens automatically (disable with `--no-metadata`)
- **Hash verification** optional but recommended (`--verify-hashes`)
- **Resume capability** for interrupted downloads
- **Update logic** using stored metadata to refresh your collection

---

## ⚙️ Configuration

You can store your preferences and credentials in a configuration file to avoid typing them every time. RetroSD looks for `.retrosdrc` or `.retrosdrc.json` in the current directory or your home directory.

**Recommendation:** We strongly recommend storing your ScreenScraper credentials here to enable artwork scraping without passing sensitive information via command-line arguments.

**Example `.retrosdrc`:**

```json
{
	"jobs": 8,
	"retryCount": 5,
	"includePrerelease": false,
	"scrapeUsername": "your_username",
	"scrapePassword": "your_password",
	"scrapeDevId": "your_dev_id",
	"scrapeDevPassword": "your_dev_password"
}
```

---

## Installation

### Prerequisites

- **Node.js** 20+ (for running RetroSD)
- **Git** (for cloning the repository)
- **ROM / MAME Tools** (optional, for CHD conversion):
  - macOS: `brew install rom-tools`
  - Linux: `apt-get install mame-tools`
  - Windows: Download from [mamedev.org](https://www.mamedev.org/)

### Install from Source

```bash
git clone https://github.com/Coriou/retrosd.git
cd retrosd
npm install
npm run build
npm link  # Makes 'retrosd' command available globally
```

### Verify Installation

```bash
retrosd --version
```

---

## 🚀 Quick Start Guide

### First Time Setup

```bash
# Download, organize, and scrape artwork for GB/GBA games
retrosd --systems=GB,GBA --preset=english --verify-hashes --scrape /path/to/sdcard

# This will:
# 1. Download BIOS files for each system
# 2. Apply the `english` preset (USA/Europe/World/etc. filename tags)
# 3. Apply 1G1R (one version per game)
# 4. Generate metadata with hashes
# 5. Download box art and generate gamelists
# 6. Create organized Bios/ and Roms/ folders
```

### Maintain Your Collection

```bash
# Scan to see what you have
retrosd scan /path/to/sdcard

# Verify integrity
retrosd verify /path/to/sdcard

# Update changed ROMs
retrosd --update --systems=GB /path/to/sdcard

# Convert PS1 games to CHD
retrosd convert /path/to/sdcard --systems=PS --delete-originals

# Generate metadata for existing ROMs
retrosd metadata /path/to/sdcard --with-hashes
```

### Add Artwork

```bash
# Download artwork from ScreenScraper
retrosd scrape /path/to/sdcard --systems=GB,GBA

# With ScreenScraper account for better limits
retrosd scrape /path/to/sdcard --systems=GB \
  --username your_user --password your_pass
```

### Export for Other Tools

```bash
# Generate manifest
retrosd export /path/to/sdcard -o ~/my-collection.json

# Import into RomM, Playnite, etc.
```

---

## 📚 Architecture

**Core Modules:**

- `bios.ts` - BIOS file downloading and management
- `roms.ts` - ROM downloading and organization with metadata integration
- `hash.ts` - SHA-1/CRC32 computation with streaming for large files
- `metadata.ts` - Filename parsing and JSON sidecar generation
- `romname.ts` - Shared ROM filename parsing (regions, languages, revisions, tags)
- `collection.ts` - Scan, verify, export operations
- `convert.ts` - CHD/CSO format conversion
- `core/scraper/` - ScreenScraper integration (API, caching, rate limiting, media download)
- `filters.ts` - Smart 1G1R priority scoring and region filtering
- `cli/index.ts` - Command-line interface with subcommands
- `types.ts` - TypeScript interfaces for type safety

**Terminal UI (Ink React):**

- `ui/App.tsx` - Root Ink app + global keybindings (e.g. `q` / `Esc` to quit)
- `ui/views/*` - Command views (download/scrape/scan/verify/convert)
- `ui/hooks/*` - Hooks that consume async generators from `core/*`
- `ui/components/*` - Shared UI primitives (progress bar, spinner, messages)

**Key Features:**

- Fully typed with TypeScript
- Parallel downloads with configurable concurrency
- Smart rate limiting for API calls
- Backpressure handling for disk I/O
- Progress tracking and detailed logging

**UI Selection (Ink vs plain output):**

- Ink UI is used automatically when running in an interactive TTY (and `--quiet` is not set)
- You can force Ink UI with `--ink` on commands that support it
- The `search` command also supports `-i/--interactive`
- For scripting / CI, use `--quiet` to disable Ink and reduce output

**Logs (Ink mode):**

- When Ink UI is enabled, RetroSD writes a per-run log file under `./.log/` and shows the path in the UI.
- Control log verbosity with `LOG_LEVEL_FILE` (recommended values: `info`, `debug`, `trace`).

---

## 🎯 What This Enables

### For Casual Users

- Cleaner collections (no duplicates)
- Verified ROMs (no corrupted files)
- Space savings (CHD compression)
- Ready for any frontend (metadata included)

### For Power Users

- DAT-compatible hashing
- Integration with RomVault/igir workflows
- Scriptable verification and maintenance
- Collection tracking over time

### For Developers

- Full TypeScript API exported
- Modular architecture
- Easy to extend with new formats/systems
- Well-documented types

---

## 📝 Usage Tips

### Smart Defaults

- **1G1R filtering** is enabled by default (use `--no-1g1r` to disable)
- **Metadata generation** is enabled by default (use `--no-metadata` to disable)
- **Prerelease, unlicensed, hacks, and homebrew** ROMs are excluded by default (use `--include-prerelease`, `--include-unlicensed`, `--include-hacks`, and `--include-homebrew` to include)

### Recommended Workflow

1. **Initial setup**: Download ROMs with metadata and hashes

   ```bash
   retrosd --systems=GB,GBA --preset=english --verify-hashes /path/to/sdcard
   ```

2. **Add artwork**: Scrape from ScreenScraper

   ```bash
   retrosd scrape /path/to/sdcard --systems=GB,GBA
   ```

3. **Maintenance**: Periodically verify collection integrity

   ```bash
   retrosd verify /path/to/sdcard
   ```

4. **Updates**: Refresh ROMs when needed
   ```bash
   retrosd --update --systems=GB /path/to/sdcard
   ```

### ScreenScraper Account

For better scraping performance:

- Register at [screenscraper.fr](https://www.screenscraper.fr)
- Free accounts get ~2 requests/second
- Paid accounts get faster limits and higher priority
- Store credentials in `.retrosdrc` to avoid typing them every time

---

## 🙏 Credits

**Inspired by:**

- RomVault (verification model)
- igir (automation approach)
- clrmamepro (DAT philosophy)
- Retool (1G1R filtering)
- RomM (metadata format)

**Built with:**

- TypeScript
- Commander.js
- Node.js crypto (hashing)
- MAME chdman (CHD conversion)
- ScreenScraper API (artwork)

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Add tests if applicable
5. Submit a pull request

### Development Setup

```bash
git clone https://github.com/Coriou/retrosd.git
cd retrosd
npm install
npm run dev  # Watch mode for development
```

### Code Style

- Follow existing TypeScript patterns
- Use ESLint and Prettier (configured)
- Write clear comments for complex logic
- Keep functions focused and testable

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
