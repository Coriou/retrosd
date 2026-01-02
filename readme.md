# RetroSD

**Brick SD Card Creator** – A modern TypeScript CLI for downloading BIOS files and ROMs for retro gaming consoles with DAT-style verification and library management.

## Features

### Core Download Features

- 🎮 **BIOS Downloads** – Automatically fetches BIOS files for FC, GB, GBA, GBC, MD, PCE, PS, and more
- 📦 **ROM Downloads** – Fetches ROMs from [Myrient](https://myrient.erista.me/) (No-Intro & Redump sources)
- 🔍 **Smart Filtering** – Region presets (USA, English, NTSC, PAL, Japanese) or custom regex
- ⚡ **Parallel Downloads** – Configurable concurrency (default: 4 parallel downloads)
- 🔄 **Resume Support** – Skip already-downloaded files with `--resume`
- 🎯 **Interactive & Non-Interactive** – Beautiful prompts for humans, flags for scripts

### Library Management (NEW)

- ✨ **1G1R (One-Game-One-ROM)** – Smart region priority filtering to keep only the best version of each game
- 📋 **Metadata Generation** – Creates .json sidecar files with title, region, version, tags, and hashes
- 🔐 **Hash Verification** – SHA-1 and CRC32 hashing for ROM integrity verification (DAT-compatible)
- 🔍 **Collection Scanning** – Catalog and analyze your ROM library
- ✅ **Verification** – Verify ROM integrity against stored hashes
- 📤 **Export** – Generate manifests for RomM, EmulationStation, and other frontends
- 💾 **Format Conversion** – Convert disc images to CHD for massive space savings

## Installation

```bash
npm install
npm run build
```

## Usage

### Download ROMs and BIOS

```bash
# Interactive mode (prompts for options)
npm run cli -- /path/to/sdcard

# BIOS only
npm run cli -- --bios-only /path/to/sdcard

# Dry run (preview what would be downloaded)
npm run cli -- --dry-run /path/to/sdcard

# Non-interactive with filters
npm run cli -- --non-interactive --sources=no-intro --systems=GB,GBA --preset=usa /path/to/sdcard

# With metadata and hash verification
npm run cli -- --verify-hashes /path/to/sdcard

# Convert disc images to CHD automatically
npm run cli -- --convert-chd --systems=PS /path/to/sdcard
```

### Library Management

```bash
# Scan your collection
npm run cli -- scan /path/to/sdcard

# Scan with hash computation (for verification)
npm run cli -- scan --hashes /path/to/sdcard

# Verify ROM integrity
npm run cli -- verify /path/to/sdcard

# Convert disc images to CHD
npm run cli -- convert /path/to/sdcard --systems=PS

# Export collection manifest
npm run cli -- export /path/to/sdcard -o collection.json
```

### Options

#### Download Options

| Option                 | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `-n, --dry-run`        | Preview actions without downloading                        |
| `-j, --jobs <n>`       | Parallel downloads (default: 4)                            |
| `--bios-only`          | Only download BIOS files                                   |
| `--roms-only`          | Only download ROMs (skip BIOS)                             |
| `--preset <name>`      | Filter: `usa`, `english`, `ntsc`, `pal`, `japanese`, `all` |
| `-f, --filter <regex>` | Custom filter pattern                                      |
| `--sources <list>`     | Comma-separated: `no-intro`, `redump`                      |
| `--systems <list>`     | Comma-separated: `GB`, `GBA`, `MD`, `FC_CART`, etc.        |
| `--resume`             | Skip existing files                                        |
| `--update`             | Revalidate remote ROMs and redownload if changed           |
| `--non-interactive`    | No prompts (for CI/scripts)                                |
| `-q, --quiet`          | Minimal output                                             |
| `--verbose`            | Debug output                                               |
| `--include-prerelease` | Include beta/demo/proto ROMs                               |
| `--include-unlicensed` | Include unlicensed/pirate ROMs                             |

#### Library Management Options (NEW)

| Option            | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `--no-1g1r`       | Disable 1G1R filtering (download all regional variants) |
| `--no-metadata`   | Skip metadata .json file generation                     |
| `--verify-hashes` | Generate SHA-1/CRC32 hashes for verification (slower)   |
| `--convert-chd`   | Automatically convert disc images to CHD format         |
| `--disk-profile`  | Disk speed: `fast`, `balanced`, `slow` (default)        |

#### Scan Command Options

| Option         | Description                            |
| -------------- | -------------------------------------- |
| `--hashes`     | Compute SHA-1/CRC32 hashes during scan |
| `-o, --output` | Export manifest to JSON file           |

#### Convert Command Options

| Option               | Description                                 |
| -------------------- | ------------------------------------------- |
| `--systems <list>`   | Systems to convert (default: PS, MD)        |
| `--delete-originals` | Delete .cue/.bin files after CHD conversion |

`--jobs` now directly controls maximum concurrent file downloads (scaled by `--disk-profile` for in-flight byte limits). For multi-system runs, a small number of systems will download in parallel to keep the pipe full.

### Available Systems

| Key          | Source   | Description               |
| ------------ | -------- | ------------------------- |
| `FC_CART`    | no-intro | Famicom (cartridge)       |
| `FC_FDS`     | no-intro | Famicom Disk System       |
| `GB`         | no-intro | Game Boy                  |
| `GBA`        | no-intro | Game Boy Advance          |
| `GBC`        | no-intro | Game Boy Color            |
| `MD`         | no-intro | Mega Drive / Genesis      |
| `PCE`        | no-intro | PC Engine / TurboGrafx-16 |
| `PKM`        | no-intro | Pokemon Mini              |
| `SGB`        | no-intro | Super Game Boy (SNES)     |
| `PS`         | redump   | PlayStation               |
| `MD_SEGA_CD` | redump   | Mega CD / Sega CD         |

## Configuration

Create `~/.brickrc` (JSON) for default settings:

```json
{
	"jobs": 8,
	"defaultPreset": "english",
	"defaultSources": ["no-intro"],
	"includePrerelease": false,
	"includeUnlicensed": false
}
```

## Output Structure

```
/path/to/sdcard/
├── Bios/
│   ├── FC/disksys.rom
│   ├── GB/gb_bios.bin
│   ├── GBA/gba_bios.bin
│   ├── GBC/gbc_bios.bin
│   ├── MD/bios_CD_*.bin
│   ├── MGBA/gba_bios.bin → ../GBA/gba_bios.bin
│   ├── PCE/syscard3.pce
│   ├── PKM/bios.min
│   ├── PRBOOM/prboom.wad, freedoom*.wad
│   ├── PS/psxonpsp660.bin
│   ├── PUAE/kick*.A*
│   └── SGB/sgb.bios
└── Roms/
    ├── FC/
    │   ├── Super Mario Bros. 2 (Japan) (En).nes
    │   └── Super Mario Bros. 2 (Japan) (En).json  # Metadata sidecar
    ├── GB/
    │   ├── Pokemon Red (USA).gb
    │   └── Pokemon Red (USA).json
    ├── GBA/*.gba
    ├── GBC/*.gbc
    ├── MD/*.md
    ├── PS/
    │   ├── Final Fantasy VII (USA).chd  # Converted from .cue/.bin
    │   └── Final Fantasy VII (USA).json
    └── .retrosd-manifest.json  # Internal tracking
```

### Metadata File Format

Each ROM gets a `.json` sidecar file with structured metadata:

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

## Development

```bash
# Watch mode
npm run dev

# Type check
npm run typecheck

# Format code
npm run format

# Lint
npm run lint
```

## Architecture

```
src/
├── cli/index.ts    # Commander entry point with subcommands
├── types.ts        # Shared type definitions
├── config.ts       # Config loading (Zod validation)
├── ui.ts           # Terminal output (chalk)
├── download.ts     # Download manager with retry
├── parallel.ts     # p-limit concurrency
├── filters.ts      # Region presets, exclusions, 1G1R logic
├── bios.ts         # BIOS download definitions
├── roms.ts         # ROM sources & download logic
├── prompts.ts      # Interactive prompts
├── hash.ts         # SHA-1/CRC32 hashing for verification
├── metadata.ts     # Metadata parsing and generation
├── collection.ts   # Scan, verify, export commands
└── convert.ts      # Format conversion (CHD, CSO)
```

## Library Management Features

### 1G1R (One-Game-One-ROM) Filtering

Automatically selects the best version of each game based on region priority:

**Priority Order:**

1. USA (100 points)
2. World (95)
3. English (90)
4. Europe (85)
5. Australia (80)
6. Japan (75)
7. Other regions...

**Version Priority:** Prefers newer revisions (Rev 3 > Rev 2 > Rev 1)

Example: If you have:

- `Super Mario Bros. (USA).nes`
- `Super Mario Bros. (Europe).nes`
- `Super Mario Bros. (Japan).nes`

Only the USA version is downloaded (unless you use `--no-1g1r`).

### Hash Verification

Generate and verify SHA-1/CRC32 hashes compatible with No-Intro and Redump DAT files:

```bash
# Generate hashes during download
npm run cli -- --verify-hashes /path/to/sdcard

# Verify existing collection
npm run cli -- verify /path/to/sdcard
```

Hashes are stored in metadata `.json` files and can be used to detect file corruption or modifications.

### Format Conversion

Convert disc-based ROMs to compressed formats:

**CHD (MAME Compressed Hunks of Data):**

- PS1: ~700MB → ~200-300MB (60-70% savings)
- Sega CD: Similar compression ratios
- Requires `chdman` from MAME tools

```bash
# Install chdman (macOS)
brew install mame

# Convert during download
npm run cli -- --convert-chd --systems=PS /path/to/sdcard

# Convert existing collection
npm run cli -- convert /path/to/sdcard --delete-originals
```

### Collection Export

Export your collection for use with other tools:

```bash
# Generate JSON manifest
npm run cli -- export /path/to/sdcard -o collection.json
```

The manifest includes:

- Complete ROM inventory with hashes
- System statistics (ROM count, total size)
- Metadata for integration with RomM, Playnite, EmulationStation

## Integration with Other Tools

### RomM (Self-Hosted ROM Library)

Export your collection and import into [RomM](https://github.com/rommapp/romm):

```bash
npm run cli -- export /path/to/sdcard -o ~/romm-import.json
```

### EmulationStation

Metadata files are compatible with EmulationStation's gamelist.xml format. RetroSD generates the foundational data that scrapers like Skraper can enhance.

### Playnite

Use the exported JSON manifest to bulk-import your collection into Playnite with accurate metadata.

## License

MIT
