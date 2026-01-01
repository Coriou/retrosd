# RetroSD

**Brick SD Card Creator** – A modern TypeScript CLI for downloading BIOS files and ROMs for retro gaming consoles.

## Features

- 🎮 **BIOS Downloads** – Automatically fetches BIOS files for FC, GB, GBA, GBC, MD, PCE, PS, and more
- 📦 **ROM Downloads** – Fetches ROMs from [Myrient](https://myrient.erista.me/) (No-Intro & Redump sources)
- 🔍 **Smart Filtering** – Region presets (USA, English, NTSC, PAL, Japanese) or custom regex
- ⚡ **Parallel Downloads** – Configurable concurrency (default: 4 parallel downloads)
- 🔄 **Resume Support** – Skip already-downloaded files with `--resume`
- 🎯 **Interactive & Non-Interactive** – Beautiful prompts for humans, flags for scripts

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
# Interactive mode (prompts for options)
npm run cli -- /path/to/sdcard

# BIOS only
npm run cli -- --bios-only /path/to/sdcard

# Dry run (preview what would be downloaded)
npm run cli -- --dry-run /path/to/sdcard

# Non-interactive with filters
npm run cli -- --non-interactive --sources=no-intro --systems=GB,GBA --preset=usa /path/to/sdcard
```

### Options

| Option | Description |
|--------|-------------|
| `-n, --dry-run` | Preview actions without downloading |
| `-j, --jobs <n>` | Parallel downloads (default: 4) |
| `--bios-only` | Only download BIOS files |
| `--roms-only` | Only download ROMs (skip BIOS) |
| `--preset <name>` | Filter: `usa`, `english`, `ntsc`, `pal`, `japanese`, `all` |
| `-f, --filter <regex>` | Custom filter pattern |
| `--sources <list>` | Comma-separated: `no-intro`, `redump` |
| `--systems <list>` | Comma-separated: `GB`, `GBA`, `MD`, `FC_CART`, etc. |
| `--resume` | Skip existing files |
| `--non-interactive` | No prompts (for CI/scripts) |
| `-q, --quiet` | Minimal output |
| `--verbose` | Debug output |
| `--include-prerelease` | Include beta/demo/proto ROMs |
| `--include-unlicensed` | Include unlicensed/pirate ROMs |

### Available Systems

| Key | Source | Description |
|-----|--------|-------------|
| `FC_CART` | no-intro | Famicom (cartridge) |
| `FC_FDS` | no-intro | Famicom Disk System |
| `GB` | no-intro | Game Boy |
| `GBA` | no-intro | Game Boy Advance |
| `GBC` | no-intro | Game Boy Color |
| `MD` | no-intro | Mega Drive / Genesis |
| `PCE` | no-intro | PC Engine / TurboGrafx-16 |
| `PKM` | no-intro | Pokemon Mini |
| `SGB` | no-intro | Super Game Boy (SNES) |
| `PS` | redump | PlayStation |
| `MD_SEGA_CD` | redump | Mega CD / Sega CD |

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
    ├── FC/*.nes
    ├── GB/*.gb
    ├── GBA/*.gba
    ├── GBC/*.gbc
    ├── MD/*.md
    └── ...
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
├── cli/index.ts    # Commander entry point
├── types.ts        # Shared type definitions
├── config.ts       # Config loading (Zod validation)
├── ui.ts           # Terminal output (chalk)
├── download.ts     # Download manager with retry
├── parallel.ts     # p-limit concurrency
├── filters.ts      # Region presets & exclusions
├── bios.ts         # BIOS download definitions
├── roms.ts         # ROM sources & download logic
└── prompts.ts      # Interactive prompts
```

## License

MIT
