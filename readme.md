# RetroSD v2.0.0 - Feature Summary

## 🎉 What's New

RetroSD has evolved from a simple ROM downloader into a comprehensive **ROM library manager** with DAT-style verification, metadata generation, and smart filtering.

## ✨ New Features

### 1. Smart 1G1R (One-Game-One-ROM) Filtering ✅

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

### 2. Metadata Generation & DAT Compatibility ✅

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

### 3. Collection Scanning & Verification ✅

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

### 4. Format Conversion (CHD) ✅

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

### 5. Collection Export ✅

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

## 🔧 Enhanced Existing Features

### Better Filtering

- **Region priority** now considers version/revision info
- **Exclusion filters** work alongside 1G1R
- **Custom regex** still supported for power users

#### Content Exclusion Filters

By default, RetroSD filters out pre-release and unlicensed content to maintain a clean, official game collection:

**`--include-prerelease`** - Include pre-release versions (excluded by default)

- **Filters out:** Beta, Demo, Proto, Sample, Preview versions
- **Example:** `Pokemon Gold (USA) (Beta).gb` is excluded by default
- **Use case:** Collectors who want development/prototype ROMs

**`--include-unlicensed`** - Include unlicensed/pirate versions (excluded by default)

- **Filters out:** Unlicensed (Unl), Pirate, Bootleg releases
- **Example:** `Super Mario 4 (Pirate).gb` is excluded by default
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

### Smarter Downloads

- Metadata generation happens automatically (disable with `--no-metadata`)
- Hash verification optional but recommended (`--verify-hashes`)
- Better resume/update logic using stored metadata

---

## 📊 State of the Art Comparison

| Feature                 | RetroSD v2.0 | RomVault | clrmamepro | igir | Skraper |
| ----------------------- | ------------ | -------- | ---------- | ---- | ------- |
| **Download ROMs**       | ✅           | ❌       | ❌         | ✅   | ❌      |
| **1G1R Filtering**      | ✅           | ✅       | ✅         | ✅   | ❌      |
| **Hash Verification**   | ✅           | ✅       | ✅         | ✅   | ❌      |
| **Metadata Generation** | ✅           | ❌       | ❌         | ❌   | ✅      |
| **Format Conversion**   | ✅           | ❌       | ❌         | ❌   | ❌      |
| **Collection Scanning** | ✅           | ✅       | ✅         | ✅   | ✅      |
| **Export Manifests**    | ✅           | ✅       | ❌         | ✅   | ❌      |
| **CLI + Interactive**   | ✅           | GUI      | GUI        | CLI  | GUI     |

**RetroSD's unique position:** The only tool that combines downloading, DAT-style verification, 1G1R filtering, metadata generation, AND format conversion in a single CLI.

---

## 🚀 Quick Start Guide

### First Time Setup

```bash
# Download and organize GB/GBA games with metadata
npm run cli -- --systems=GB,GBA --preset=english --verify-hashes /path/to/sdcard

# This will:
# 1. Download only English-region ROMs
# 2. Apply 1G1R (one version per game)
# 3. Generate metadata with hashes
# 4. Create organized Roms/GB and Roms/GBA folders
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
```

### Export for Other Tools

```bash
# Generate manifest
retrosd export /path/to/sdcard -o ~/my-collection.json

# Import into RomM, Playnite, etc.
```

---

## 📚 Architecture

**New Modules:**

- `hash.ts` - SHA-1/CRC32 computation with streaming for large files
- `metadata.ts` - Filename parsing and JSON sidecar generation
- `collection.ts` - Scan, verify, export operations
- `convert.ts` - CHD/CSO format conversion
- `filters.ts` - Enhanced with 1G1R priority scoring

**Enhanced:**

- `roms.ts` - Integrated metadata generation after extraction
- `cli/index.ts` - Added subcommands: scan, verify, convert, export
- `types.ts` - New interfaces for collection management

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

Based on the research, natural next steps could include:

1. **DAT Import** - Directly use No-Intro/Redump DAT files for validation
2. **Auto-Update DATs** - Keep DAT files current automatically
3. **Scraper Integration** - Pull artwork/videos from ScreenScraper API
4. **Duplicate Detection** - Find and merge ROMs with different naming
5. **RVZ Support** - GameCube/Wii compression format
6. **Playlist Generation** - Auto-create RetroArch playlists

---

## 📝 Migration Guide

### From v1.0 to v2.0

**Breaking Changes:** None! All v1.0 commands work as before.

**New Defaults:**

- 1G1R filtering is now **enabled by default** (use `--no-1g1r` to disable)
- Metadata generation is **enabled by default** (use `--no-metadata` to disable)

**Recommendations:**

1. Run `retrosd scan --hashes /path/to/sdcard` on existing collections to generate metadata
2. Use `retrosd verify /path/to/sdcard` to check integrity
3. Consider converting PS1/Sega CD to CHD with `retrosd convert`

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
