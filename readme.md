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
- Uses intelligent region priority scoring (USA > World > English > Europe > Japan...)
- Prefers newer revisions (Rev 3 > Rev 2 > Rev 1)

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

You get just: `Super Mario Bros. (USA).nes` (the highest priority version)

---

### 3. Metadata Generation & DAT Compatibility ✅

**What it does:**

- Creates `.json` sidecar files for every ROM
- Parses filename to extract: title, region, version, tags
- Generates SHA-1 and CRC32 hashes (compatible with No-Intro/Redump DATs)
- Tracks file size and timestamps

**Why it matters:**

- Makes your collection compatible with ROM managers like RomVault, clrmamepro, igir
- Enables integration with RomM, Playnite, EmulationStation
- Provides data for scrapers to work more accurately
- Allows verification of ROM integrity over time

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

**New Commands:**

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

### 5. Format Conversion (CHD) ✅

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
retrosd --convert-chd --systems=PS /path/to/sdcard

# Convert existing collection
retrosd convert /path/to/sdcard --delete-originals
```

**Requirements:**

- macOS: `brew install mame`
- Linux: `apt-get install mame-tools`

---

### 6. Collection Export ✅

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

### 7. Artwork & Media Scraping ✅

**What it does:**

- Downloads box art, screenshots, videos from ScreenScraper
- Generates EmulationStation-compatible gamelists
- Supports multiple media types and regions
- Intelligent caching to avoid redundant API calls

**Why it matters:**

- Beautiful visual frontend experience
- No manual artwork hunting
- EmulationStation-ready out of the box
- Respects ScreenScraper rate limits with smart threading

**Usage:**

```bash
# Scrape artwork for Game Boy
retrosd scrape /path/to/sdcard --systems=GB

# With ScreenScraper account for faster speeds
retrosd scrape /path/to/sdcard --systems=GB,GBA \
  --username your_username --password your_password

# Media types: box-2d (front/back), screenshot, video
retrosd scrape /path/to/sdcard --systems=GB \
  --media=box-2d,screenshot
```

**Supported systems:**
All major systems including GB, GBA, GBC, NES, SNES, Genesis, PS1, and more.

---

### 8. Metadata Generation Command ✅

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

- **Region priority** considers both region and version/revision info
- **Exclusion filters** work alongside 1G1R for precise control
- **Custom regex** patterns for power users with specific needs
- **Presets** for common preferences (usa, english, ntsc, pal, japanese, all)

#### Content Exclusion Filters

By default, RetroSD filters out pre-release and unlicensed content to maintain a clean, official game collection:

**`--include-prerelease`** - Include pre-release versions (excluded by default)

- **Includes:** Beta, Demo, Proto, Sample, Preview versions
- **Example:** `Pokemon Gold (USA) (Beta).gb`
- **Use case:** Collectors who want development/prototype ROMs

**`--include-unlicensed`** - Include unlicensed/pirate versions (excluded by default)

- **Includes:** Unlicensed (Unl), Pirate, Bootleg releases
- **Example:** `Super Mario 4 (Pirate).gb`
- **Use case:** Preservation or testing unofficial releases

**Combine both flags** to include everything, or use neither for curated official releases only.

```bash
# Default: official releases only (no betas, no pirates)
retrosd --systems=GB /path/to/sdcard

# Include beta/demo versions
retrosd --systems=GB --include-prerelease /path/to/sdcard

# Include everything (official + betas + unlicensed)
retrosd --systems=GB --include-prerelease --include-unlicensed /path/to/sdcard
```

### Download Features

- **Metadata generation** happens automatically (disable with `--no-metadata`)
- **Hash verification** optional but recommended (`--verify-hashes`)
- **Resume capability** for interrupted downloads
- **Update logic** using stored metadata to refresh your collection

---

## Installation

### Prerequisites

- **Node.js** 20+ (for running RetroSD)
- **Git** (for cloning the repository)
- **MAME Tools** (optional, for CHD conversion):
  - macOS: `brew install mame`
  - Linux: `apt-get install mame-tools`
  - Windows: Download from [mamedev.org](https://www.mamedev.org/)

### Install from NPM

```bash
npm install -g retrosd
retrosd --help
```

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

## �🚀 Quick Start Guide

### First Time Setup

```bash
# Download and organize GB/GBA games with metadata
retrosd --systems=GB,GBA --preset=english --verify-hashes /path/to/sdcard

# This will:
# 1. Download BIOS files for each system
# 2. Download only English-region ROMs
# 3. Apply 1G1R (one version per game)
# 4. Generate metadata with hashes
# 5. Create organized Bios/ and Roms/ folders
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
- `collection.ts` - Scan, verify, export operations
- `convert.ts` - CHD/CSO format conversion
- `scrape.ts` - ScreenScraper API integration for artwork/media
- `filters.ts` - Smart 1G1R priority scoring and region filtering
- `cli/index.ts` - Command-line interface with subcommands
- `types.ts` - TypeScript interfaces for type safety

**Key Features:**

- Fully typed with TypeScript
- Parallel downloads with configurable concurrency
- Smart rate limiting for API calls
- Backpressure handling for disk I/O
- Progress tracking and detailed logging

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

## 🔮 Future Possibilities

Natural next steps could include:

1. **DAT Import** - Directly use No-Intro/Redump DAT files for validation
2. **Auto-Update DATs** - Keep DAT files current automatically
3. **Duplicate Detection** - Find and merge ROMs with different naming
4. **RVZ Support** - GameCube/Wii compression format
5. **Playlist Generation** - Auto-create RetroArch playlists
6. **Additional Scrapers** - Support for other artwork sources (TheGamesDB, etc.)
7. **Web Interface** - Optional GUI for easier management

---

## 📝 Usage Tips

### Smart Defaults

- **1G1R filtering** is enabled by default (use `--no-1g1r` to disable)
- **Metadata generation** is enabled by default (use `--no-metadata` to disable)
- **Prerelease & unlicensed** ROMs are excluded by default (use `--include-prerelease` and `--include-unlicensed` to include)

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
- Use `--username` and `--password` flags for authentication

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
