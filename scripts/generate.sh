#!/bin/bash
# =============================================================================
# Brick SD Card Creator
# State-of-the-art BIOS & ROM downloader for retro gaming consoles
# =============================================================================
# Version: 2.0.0
# License: MIT
# Usage: ./create_brick_sd.sh [OPTIONS] /path/to/sdcard
# Compatible with Bash 3.2+ (macOS default)
# =============================================================================

VERSION="2.0.0"

# Enable strict mode
set -o pipefail
set -e

# =============================================================================
# Color & Output Functions
# =============================================================================
setup_colors() {
  if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m'
  else
    RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' DIM='' NC=''
  fi
}

info()    { echo -e "${BLUE}ℹ${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*" >&2; }
error()   { echo -e "${RED}✗${NC} $*" >&2; }
debug()   { [[ "${VERBOSE:-0}" == "1" ]] && echo -e "${DIM}  → $*${NC}" || true; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; }

setup_colors

# =============================================================================
# Configuration
# =============================================================================
CONFIG_FILE="${BRICK_SD_CONFIG:-$HOME/.brick_sd.conf}"
DEFAULT_JOBS=4
DEFAULT_RETRY_COUNT=3
DEFAULT_RETRY_DELAY=2
USER_AGENT="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) brick-sd-creator/${VERSION}"

# =============================================================================
# Global State
# =============================================================================
DL_DONE=""
DL_FAILED=""
ROM_DONE=""
ROM_FAILED=""
CLEANUP_FILES=""

# Count tracking for summary
DL_DONE_COUNT=0
DL_FAILED_COUNT=0
ROM_DONE_COUNT=0
ROM_FAILED_COUNT=0

add_dl_done() {
  DL_DONE="${DL_DONE}${1}\n"
  DL_DONE_COUNT=$((DL_DONE_COUNT + 1))
}

add_dl_failed() {
  DL_FAILED="${DL_FAILED}${1}\n"
  DL_FAILED_COUNT=$((DL_FAILED_COUNT + 1))
}

add_rom_done() {
  ROM_DONE="${ROM_DONE}${1}\n"
  ROM_DONE_COUNT=$((ROM_DONE_COUNT + 1))
}

add_rom_failed() {
  ROM_FAILED="${ROM_FAILED}${1}\n"
  ROM_FAILED_COUNT=$((ROM_FAILED_COUNT + 1))
}

# =============================================================================
# ROM Source URLs (function-based lookup for Bash 3.2 compatibility)
# =============================================================================
get_source_url() {
  case "$1" in
    no_intro) echo "https://myrient.erista.me/files/No-Intro" ;;
    redump)   echo "https://myrient.erista.me/files/Redump" ;;
    *)        echo "" ;;
  esac
}

get_dest_dir() {
  case "$1" in
    FC_CART|FC_FDS) echo "FC" ;;
    GB)       echo "GB" ;;
    GBA)      echo "GBA" ;;
    GBC)      echo "GBC" ;;
    MD|MD_SEGA_CD) echo "MD" ;;
    PCE)      echo "PCE" ;;
    PKM)      echo "PKM" ;;
    SGB)      echo "SGB" ;;
    PS)       echo "PS" ;;
    *)        echo "" ;;
  esac
}

# ROM matrix entries (:: delimited to avoid conflict with regex | in patterns)
# system_key::source::remote_path::archive_regex::extract_glob::label::extract_flag
ROM_ENTRIES="
FC_CART::no_intro::Nintendo%20-%20Famicom/::\.zip::*.nes::Famicom (cart)::extract
FC_FDS::no_intro::Nintendo%20-%20Family%20Computer%20Disk%20System%20%28FDS%29/::\.zip::*.fds::Famicom Disk System::extract
GB::no_intro::Nintendo%20-%20Game%20Boy/::\.zip::*.gb::Game Boy::extract
GBA::no_intro::Nintendo%20-%20Game%20Boy%20Advance/::\.zip::*.gba::Game Boy Advance::extract
GBC::no_intro::Nintendo%20-%20Game%20Boy%20Color/::\.zip::*.gbc::Game Boy Color::extract
MD::no_intro::Sega%20-%20Mega%20Drive%20-%20Genesis/::\.zip::*.md::Mega Drive / Genesis::extract
PCE::no_intro::NEC%20-%20PC%20Engine%20-%20TurboGrafx-16/::\.zip::*.pce::PC Engine::extract
PKM::no_intro::Nintendo%20-%20Pokemon%20Mini/::\.zip::*.min::Pokemon Mini::extract
SGB::no_intro::Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/::\.zip::*.sfc::Super Game Boy (SNES)::extract
PS::redump::Sony%20-%20PlayStation/::.(zip|7z)::*::PlayStation (Redump)::keep
MD_SEGA_CD::redump::Sega%20-%20Mega-CD%20-%20Sega%20CD/::.(zip|7z)::*::Mega CD / Sega CD (Redump)::keep
"

# =============================================================================
# CLI Arguments (with defaults)
# =============================================================================
SDCARD_ROOT=""
FILTER=""
JOBS="${JOBS:-$DEFAULT_JOBS}"
INTERACTIVE=1
REQUESTED_SOURCES=""
REQUESTED_SYSTEMS=""
DRY_RUN=0
VERBOSE=0
QUIET=0
BIOS_ONLY=0
ROMS_ONLY=0
RESUME=0
VERIFY=0
RETRY_COUNT=$DEFAULT_RETRY_COUNT
RETRY_DELAY=$DEFAULT_RETRY_DELAY
PRESET=""
INCLUDE_PRERELEASE=0
INCLUDE_UNLICENSED=0

# =============================================================================
# Region Filter Presets
# =============================================================================
get_preset_filter() {
  local preset="$1"
  case "$preset" in
    usa-only|usa)
      echo '\(USA\)' ;;
    english|en)
      echo '\(USA\|Europe\|World\|Australia\|En\)' ;;
    ntsc)
      echo '\(USA\|Japan\|Korea\)' ;;
    pal)
      echo '\(Europe\|Australia\|Germany\|France\|Spain\|Italy\|Netherlands\|Sweden\)' ;;
    japanese|japan|ja)
      echo '\(Japan\)' ;;
    complete|all|"")
      echo '' ;;
    *)
      warn "Unknown preset: $preset. Using no filter."
      echo '' ;;
  esac
}

get_exclusion_filter() {
  local excludes=""
  if [[ $INCLUDE_PRERELEASE -eq 0 ]]; then
    excludes='(Beta|Demo|Proto|Sample|Preview)'
  fi
  if [[ $INCLUDE_UNLICENSED -eq 0 ]]; then
    [[ -n "$excludes" ]] && excludes="$excludes|" 
    excludes="${excludes}(Unl|Pirate|Bootleg)"
  fi
  echo "$excludes"
}

# =============================================================================
# Help & Version
# =============================================================================
usage() {
  cat <<EOF
${BOLD}Brick SD Card Creator${NC} v${VERSION}
Automated BIOS & ROM downloader for retro gaming consoles.

${BOLD}USAGE:${NC}
  $0 [OPTIONS] /path/to/sdcard

${BOLD}OPTIONS:${NC}
  ${BOLD}-h, --help${NC}              Show this help message
  ${BOLD}-v, --version${NC}           Show version number
  ${BOLD}-n, --dry-run${NC}           Preview actions without downloading
  ${BOLD}-q, --quiet${NC}             Suppress non-essential output
  ${BOLD}--verbose${NC}               Show detailed debug output
  ${BOLD}-j, --jobs N${NC}            Parallel downloads (default: $DEFAULT_JOBS)
  ${BOLD}-f, --filter REGEX${NC}      Filter ROMs by filename regex
  ${BOLD}--preset NAME${NC}           Filter preset: usa-only, english, ntsc, pal, japanese, complete
  ${BOLD}--include-prerelease${NC}    Include beta/demo/proto ROMs (excluded by default)
  ${BOLD}--include-unlicensed${NC}    Include unlicensed/pirate ROMs (excluded by default)
  ${BOLD}--bios-only${NC}             Only download BIOS files
  ${BOLD}--roms-only${NC}             Only download ROMs (skip BIOS)
  ${BOLD}--rom-sources LIST${NC}      Comma-separated: no-intro,redump
  ${BOLD}--rom-systems LIST${NC}      Comma-separated: GB,GBA,MD,FC_CART,etc.
  ${BOLD}--non-interactive${NC}       No prompts (for automation/CI)
  ${BOLD}--resume${NC}                Resume interrupted downloads
  ${BOLD}--verify${NC}                Verify existing files with checksums
  ${BOLD}--retry-count N${NC}         Max retry attempts (default: $DEFAULT_RETRY_COUNT)
  ${BOLD}--config FILE${NC}           Config file (default: ~/.brick_sd.conf)

${BOLD}EXAMPLES:${NC}
  # Download BIOS only (quick setup)
  $0 --bios-only /Volumes/SDCARD

  # Download Game Boy ROMs with USA filter
  $0 --rom-sources=no-intro --rom-systems=GB --filter="(USA)" /Volumes/SDCARD

  # Dry-run to see what would be downloaded
  $0 --dry-run --rom-sources=no-intro /Volumes/SDCARD

  # Resume interrupted download
  $0 --resume /Volumes/SDCARD

${BOLD}CONFIG FILE:${NC}
  Create ~/.brick_sd.conf with default settings:
    JOBS=8
    FILTER="(USA|Europe)"
    REQUESTED_SOURCES="no-intro"

EOF
  exit 0
}

show_version() {
  echo "brick-sd-creator ${VERSION}"
  exit 0
}

# =============================================================================
# Config File Loading
# =============================================================================
load_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    debug "Loading config from $CONFIG_FILE"
    # shellcheck source=/dev/null
    source "$CONFIG_FILE" 2>/dev/null || warn "Failed to load config file: $CONFIG_FILE"
  fi
}

# =============================================================================
# Dependency Checks
# =============================================================================
need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Missing required dependency: ${BOLD}$1${NC}"
    echo "  Install with: $2" >&2
    exit 1
  fi
}

check_dependencies() {
  need_cmd curl "brew install curl"
  need_cmd unzip "brew install unzip"
  need_cmd wget "brew install wget"
}

# =============================================================================
# Cleanup Handler
# =============================================================================
cleanup() {
  local exit_code=$?
  if [[ -n "$CLEANUP_FILES" ]]; then
    echo "$CLEANUP_FILES" | while IFS= read -r f; do
      [[ -n "$f" ]] && [[ -f "$f" ]] && rm -f "$f"
    done
  fi
  exit $exit_code
}
trap cleanup EXIT INT TERM

register_cleanup() {
  CLEANUP_FILES="${CLEANUP_FILES}${1}\n"
}

# =============================================================================
# Manifest Management (for resume/verify)
# =============================================================================
MANIFEST_FILE=""

init_manifest() {
  MANIFEST_FILE="$SDCARD_ROOT/.brick_sd_manifest.json"
  if [[ ! -f "$MANIFEST_FILE" ]]; then
    echo '{"version":"1.0","files":{}}' > "$MANIFEST_FILE"
  fi
}

compute_sha256() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" 2>/dev/null | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" 2>/dev/null | cut -d' ' -f1
  fi
}

# =============================================================================
# Download Functions
# =============================================================================
download_with_retry() {
  local url="$1"
  local dest="$2"
  local label="${3:-$(basename "$dest")}"
  local attempt=1
  local delay=$RETRY_DELAY
  
  while [[ $attempt -le $RETRY_COUNT ]]; do
    if [[ $attempt -gt 1 ]]; then
      warn "Retry $attempt/$RETRY_COUNT for $label (waiting ${delay}s)"
      sleep $delay
      delay=$((delay * 2))
    fi
    
    local tmp_dest="${dest}.tmp.$$"
    register_cleanup "$tmp_dest"
    
    local curl_args="-fL --user-agent '$USER_AGENT' --connect-timeout 10 --max-time 300 -o '$tmp_dest'"
    
    if [[ -f "$dest" ]]; then
      curl_args="$curl_args -z '$dest'"
    fi
    
    if [[ $QUIET -eq 1 ]]; then
      curl_args="$curl_args -s"
    else
      curl_args="$curl_args --progress-bar"
    fi
    
    if eval "curl $curl_args '$url'" 2>/dev/null; then
      if [[ -f "$tmp_dest" ]] && [[ -s "$tmp_dest" ]]; then
        mv "$tmp_dest" "$dest"
      fi
      return 0
    fi
    
    rm -f "$tmp_dest"
    attempt=$((attempt + 1))
  done
  
  return 1
}

download_file() {
  local dest_dir="$1"
  local url="$2"
  local out_name="${3:-$(basename "$url")}"
  local label="${4:-$out_name}"
  local fallback_url="${5:-}"
  local dest_path="$dest_dir/$out_name"
  
  mkdir -p "$dest_dir"
  
  # Check if already exists and resume mode
  if [[ $RESUME -eq 1 ]] && [[ -f "$dest_path" ]]; then
    debug "Skipping existing: $label"
    add_dl_done "$label (exists)"
    return 0
  fi
  
  if [[ $DRY_RUN -eq 1 ]]; then
    info "[DRY-RUN] Would download: $label"
    info "  URL: $url"
    info "  Dest: $dest_path"
    add_dl_done "$label (dry-run)"
    return 0
  fi
  
  debug "Downloading: $label"
  
  if download_with_retry "$url" "$dest_path" "$label"; then
    success "$label"
    add_dl_done "$label"
    return 0
  fi
  
  if [[ -n "$fallback_url" ]]; then
    debug "Trying fallback URL for $label"
    if download_with_retry "$fallback_url" "$dest_path" "$label"; then
      success "$label (fallback)"
      add_dl_done "$label (fallback)"
      return 0
    fi
  fi
  
  error "Failed to download: $label"
  add_dl_failed "$label"
  return 1
}

# =============================================================================
# Utility Functions
# =============================================================================
contains() {
  local needle="$1"; shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

normalize_source_key() {
  local key="$1"
  echo "${key//-/_}"
}

normalize_jobs() {
  if ! [[ "$JOBS" =~ ^[0-9]+$ ]] || [[ $JOBS -lt 1 ]]; then
    warn "Invalid jobs value '$JOBS', defaulting to $DEFAULT_JOBS"
    JOBS=$DEFAULT_JOBS
  fi
  if [[ $JOBS -gt 16 ]]; then
    warn "Jobs capped at 16 to avoid rate limiting"
    JOBS=16
  fi
}

# =============================================================================
# Interactive Prompts
# =============================================================================
prompt_yes_no() {
  local prompt="$1"
  local default_yes=${2:-1}
  local default_char reply
  
  if [[ $default_yes -eq 1 ]]; then
    default_char="Y/n"
  else
    default_char="y/N"
  fi
  
  while true; do
    read -r -p "$prompt [$default_char] " reply || return 1
    if [[ -z "$reply" ]]; then
      [[ $default_yes -eq 1 ]] && return 0 || return 1
    fi
    case "$reply" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "Please answer y or n." ;;
    esac
  done
}

prompt_source_selection() {
  echo
  echo -e "${BOLD}ROM sources available:${NC}"
  echo "  1) no-intro"
  echo "  2) redump"
  
  read -r -p "Choose sources (comma-separated numbers, 'all', default 1): " selection
  selection=${selection:-1}
  
  SELECTED_SOURCES=""
  
  if [[ "$selection" == "all" ]]; then
    SELECTED_SOURCES="no_intro redump"
    return
  fi
  
  IFS=',' read -r -a picks <<< "$selection"
  for pick in "${picks[@]}"; do
    case "$pick" in
      1) SELECTED_SOURCES="$SELECTED_SOURCES no_intro" ;;
      2) SELECTED_SOURCES="$SELECTED_SOURCES redump" ;;
    esac
  done
  
  if [[ -z "$SELECTED_SOURCES" ]]; then
    SELECTED_SOURCES="no_intro"
  fi
}

prompt_filter_selection() {
  # Skip if already set via CLI
  if [[ -n "$FILTER" ]] || [[ -n "$PRESET" ]]; then
    return
  fi
  
  echo
  echo -e "${BOLD}Filter options:${NC}"
  echo "  1) USA only            - (USA) ROMs"
  echo "  2) English regions     - (USA), (Europe), (World), (Australia)"
  echo "  3) NTSC regions        - (USA), (Japan), (Korea)"
  echo "  4) PAL regions         - (Europe), (Australia), (Germany), (France)"
  echo "  5) Japanese only       - (Japan) ROMs"
  echo "  6) Complete (no filter)- All ROMs"
  echo "  7) Custom regex        - Your own filter pattern"
  
  read -r -p "Choose filter [1-7, default 6]: " selection
  selection=${selection:-6}
  
  case "$selection" in
    1) PRESET="usa-only" ;;
    2) PRESET="english" ;;
    3) PRESET="ntsc" ;;
    4) PRESET="pal" ;;
    5) PRESET="japanese" ;;
    6) PRESET="complete" ;;
    7)
      read -r -p "Enter filter regex (e.g. '(USA|Europe)'): " FILTER
      ;;
    *) PRESET="complete" ;;
  esac
}

prompt_system_selection() {
  local chosen_sources="$1"
  
  # Create temp files for cross-subshell communication (pipes create subshells)
  local tmp_entries tmp_selected tmp_count
  tmp_entries=$(mktemp)
  tmp_selected=$(mktemp)
  tmp_count=$(mktemp)
  register_cleanup "$tmp_entries"
  register_cleanup "$tmp_selected"
  register_cleanup "$tmp_count"
  
  echo "0" > "$tmp_count"
  
  echo
  echo -e "${BOLD}Systems available:${NC}"
  
  # First pass: display menu and collect matching entries
  echo -e "$ROM_ENTRIES" | while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    local system_key source_key label
    system_key=$(echo "$entry" | awk -F'::' '{print $1}')
    source_key=$(echo "$entry" | awk -F'::' '{print $2}')
    label=$(echo "$entry" | awk -F'::' '{print $6}')
    
    # Check if source is in chosen sources
    if echo "$chosen_sources" | grep -q "$source_key"; then
      local current_idx
      current_idx=$(cat "$tmp_count")
      current_idx=$((current_idx + 1))
      echo "$current_idx" > "$tmp_count"
      echo "  $current_idx) $label [$source_key]"
      echo "$entry" >> "$tmp_entries"
    fi
  done || true
  
  local total_count
  total_count=$(cat "$tmp_count")
  
  if [[ "$total_count" -eq 0 ]]; then
    error "No ROM systems available for selected sources."
    rm -f "$tmp_entries" "$tmp_selected" "$tmp_count"
    return 1
  fi
  
  read -r -p "Choose systems (comma-separated numbers, 'all', default all): " selection
  selection=${selection:-all}
  
  SELECTED_ENTRIES=""
  
  if [[ "$selection" == "all" ]]; then
    SELECTED_ENTRIES=$(cat "$tmp_entries")
    rm -f "$tmp_entries" "$tmp_selected" "$tmp_count"
    return 0
  fi
  
  # Parse user selection and match against indexed entries
  IFS=',' read -r -a picks <<< "$selection"
  local line_num=0
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    line_num=$((line_num + 1))
    for pick in "${picks[@]}"; do
      pick=$(echo "$pick" | tr -d ' ')
      if [[ "$pick" == "$line_num" ]]; then
        echo "$entry" >> "$tmp_selected"
        break
      fi
    done
  done < "$tmp_entries"
  
  if [[ -f "$tmp_selected" ]] && [[ -s "$tmp_selected" ]]; then
    SELECTED_ENTRIES=$(cat "$tmp_selected")
  else
    # Fallback to all if no valid selection
    SELECTED_ENTRIES=$(cat "$tmp_entries")
  fi
  
  rm -f "$tmp_entries" "$tmp_selected" "$tmp_count"
}

# =============================================================================
# ROM Download Logic
# =============================================================================
download_rom_entry() {
  local entry="$1"
  local system_key source_key remote_path archive_regex extract_glob label extract_flag
  
  system_key=$(echo "$entry" | awk -F'::' '{print $1}')
  source_key=$(echo "$entry" | awk -F'::' '{print $2}')
  remote_path=$(echo "$entry" | awk -F'::' '{print $3}')
  archive_regex=$(echo "$entry" | awk -F'::' '{print $4}')
  extract_glob=$(echo "$entry" | awk -F'::' '{print $5}')
  label=$(echo "$entry" | awk -F'::' '{print $6}')
  extract_flag=$(echo "$entry" | awk -F'::' '{print $7}')
  
  local base_url
  base_url=$(get_source_url "$source_key")
  if [[ -z "$base_url" ]]; then
    add_rom_failed "$label [$source_key]: source URL missing"
    return
  fi
  
  local dest_suffix
  dest_suffix=$(get_dest_dir "$system_key")
  if [[ -z "$dest_suffix" ]]; then
    add_rom_failed "$label [$source_key]: destination mapping missing"
    return
  fi
  
  local dest_dir="$ROMS_DIR/$dest_suffix"
  mkdir -p "$dest_dir"
  
  if [[ $DRY_RUN -eq 1 ]]; then
    info "[DRY-RUN] Would fetch ROM listing: $label"
    info "  Source: $base_url/$remote_path"
    info "  Dest: $dest_dir"
    add_rom_done "$label (dry-run)"
    return
  fi
  
  info "Fetching listing for: $label"
  
  local listing
  listing=$(curl -s --user-agent "$USER_AGENT" "$base_url/$remote_path" | grep -oE "href=\"[^\"]+${archive_regex}\"" | sed 's/href="//;s/"$//' || true)
  
  # Apply preset filter if set
  local active_filter=""
  if [[ -n "$PRESET" ]]; then
    active_filter=$(get_preset_filter "$PRESET")
  fi
  if [[ -n "$FILTER" ]]; then
    active_filter="$FILTER"
  fi
  
  if [[ -n "$active_filter" ]]; then
    debug "Applying filter: $active_filter"
    listing=$(echo "$listing" | grep -E "$active_filter" || true)
  fi
  
  # Apply exclusion filter (demos, betas, unlicensed)
  local exclusion_filter
  exclusion_filter=$(get_exclusion_filter)
  if [[ -n "$exclusion_filter" ]]; then
    debug "Excluding: $exclusion_filter"
    listing=$(echo "$listing" | grep -Ev "$exclusion_filter" || true)
  fi
  
  local skipped_existing=0
  local queue=""
  local queue_count=0
  
  while IFS= read -r fname; do
    [[ -z "$fname" ]] && continue
    local base_no_ext="${fname%.*}"
    
    if ls "$dest_dir/$base_no_ext".* >/dev/null 2>&1 || [[ -f "$dest_dir/$fname" ]]; then
      skipped_existing=$((skipped_existing + 1))
      continue
    fi
    queue="${queue}${fname}\n"
    queue_count=$((queue_count + 1))
  done <<< "$listing"
  
  if [[ $queue_count -eq 0 ]]; then
    success "$label: nothing to download (skipped $skipped_existing existing)"
    add_rom_done "$label [$source_key]: skipped $skipped_existing existing"
    return
  fi
  
  info "$label: downloading $queue_count files ($skipped_existing skipped) [${JOBS} parallel]"
  
  local tmp_ok tmp_fail tmp_progress tmp_script
  tmp_ok=$(mktemp)
  tmp_fail=$(mktemp)
  tmp_progress=$(mktemp)
  tmp_script=$(mktemp)
  register_cleanup "$tmp_ok"
  register_cleanup "$tmp_fail"
  register_cleanup "$tmp_progress"
  register_cleanup "$tmp_script"
  
  echo "0" > "$tmp_progress"
  
  # Create download script for xargs
  cat > "$tmp_script" << 'DOWNLOAD_SCRIPT'
#!/bin/bash
fname="$1"
dest_dir="$2"
url_base="$3"
retry_count="$4"
retry_delay="$5"
user_agent="$6"
tmp_ok="$7"
tmp_fail="$8"
tmp_progress="$9"
total="${10}"

attempt=1
delay=$retry_delay

while [[ $attempt -le $retry_count ]]; do
  if wget -q -c --user-agent="$user_agent" -P "$dest_dir" "${url_base}${fname}" 2>/dev/null; then
    echo "$fname" >> "$tmp_ok"
    # Update progress counter
    count=$(cat "$tmp_progress" 2>/dev/null || echo 0)
    count=$((count + 1))
    echo "$count" > "$tmp_progress"
    printf "\r  [%d/%d] Downloaded: %s" "$count" "$total" "${fname:0:50}" >&2
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep $delay
  delay=$((delay * 2))
done

echo "$fname" >> "$tmp_fail"
exit 1
DOWNLOAD_SCRIPT
  chmod +x "$tmp_script"
  
  # Execute downloads in parallel
  echo -e "$queue" | grep -v '^$' | xargs -P "$JOBS" -I{} \
    "$tmp_script" {} "$dest_dir" "$base_url/$remote_path" "$RETRY_COUNT" "$RETRY_DELAY" "$USER_AGENT" "$tmp_ok" "$tmp_fail" "$tmp_progress" "$queue_count"
  
  echo  # newline after progress
  
  local downloaded failed
  downloaded=$(wc -l < "$tmp_ok" 2>/dev/null | tr -d ' ' || echo 0)
  failed=$(wc -l < "$tmp_fail" 2>/dev/null | tr -d ' ' || echo 0)
  
  if [[ "$extract_flag" == "extract" ]]; then
    info "Extracting archives..."
    for archive in "$dest_dir"/*.zip; do
      [[ -f "$archive" ]] || continue
      unzip -n -j "$archive" "$extract_glob" -d "$dest_dir" >/dev/null 2>&1 || true
    done
  fi
  
  if [[ $failed -gt 0 ]]; then
    warn "$label: $downloaded downloaded, $skipped_existing skipped, $failed failed"
    add_rom_failed "$label [$source_key]: $downloaded ok, $skipped_existing skipped, $failed failed"
  else
    success "$label: $downloaded downloaded, $skipped_existing skipped"
    add_rom_done "$label [$source_key]: $downloaded ok, $skipped_existing skipped"
  fi
  
  rm -f "$tmp_ok" "$tmp_fail" "$tmp_progress" "$tmp_script"
}

run_selected_rom_downloads() {
  SELECTED_SOURCES=""
  SELECTED_ENTRIES=""
  
  if [[ -n "$REQUESTED_SOURCES" ]]; then
    IFS=',' read -r -a raw_sources <<< "$REQUESTED_SOURCES"
    for s in "${raw_sources[@]}"; do
      SELECTED_SOURCES="$SELECTED_SOURCES $(normalize_source_key "$s")"
    done
  fi
  
  if [[ $INTERACTIVE -eq 1 ]] && [[ -t 0 ]]; then
    if ! prompt_yes_no "Download ROMs now?" 0; then
      info "Skipping ROM downloads."
      return
    fi
    if [[ -z "$SELECTED_SOURCES" ]]; then
      prompt_source_selection
    fi
    prompt_system_selection "$SELECTED_SOURCES" || return
    prompt_filter_selection
  else
    if [[ -z "$SELECTED_SOURCES" ]]; then
      info "Skipping ROM downloads (non-interactive, no sources specified)."
      return
    fi
    
    if [[ -n "$REQUESTED_SYSTEMS" ]]; then
      IFS=',' read -r -a requested_sys <<< "$REQUESTED_SYSTEMS"
      while IFS= read -r entry; do
        [[ -z "$entry" ]] && continue
        local system_key source_key
        system_key=$(echo "$entry" | awk -F'::' '{print $1}')
        source_key=$(echo "$entry" | awk -F'::' '{print $2}')
        if echo "$SELECTED_SOURCES" | grep -q "$source_key"; then
          for sys in "${requested_sys[@]}"; do
            if [[ "$sys" == "$system_key" ]]; then
              SELECTED_ENTRIES="${SELECTED_ENTRIES}${entry}
"
            fi
          done
        fi
      done < <(echo -e "$ROM_ENTRIES")
    else
      while IFS= read -r entry; do
        [[ -z "$entry" ]] && continue
        local source_key
        source_key=$(echo "$entry" | awk -F'::' '{print $2}')
        if echo "$SELECTED_SOURCES" | grep -q "$source_key"; then
          SELECTED_ENTRIES="${SELECTED_ENTRIES}${entry}
"
        fi
      done < <(echo -e "$ROM_ENTRIES")
    fi
  fi
  
  if [[ -z "$SELECTED_ENTRIES" ]]; then
    info "No ROM selections made; nothing to download."
    return
  fi
  
  header "Downloading ROMs"
  
  echo -e "$SELECTED_ENTRIES" | while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    download_rom_entry "$entry"
  done
}

# =============================================================================
# BIOS Downloads
# =============================================================================
download_all_bios() {
  header "Downloading BIOS Files"
  
  local BASE_URL="https://raw.githubusercontent.com/Abdess/retroarch_system/libretro"
  
  mkdir -p "$BIOS_DIR/FC" "$BIOS_DIR/GB" "$BIOS_DIR/GBA" "$BIOS_DIR/GBC" "$BIOS_DIR/MD" \
           "$BIOS_DIR/MGBA" "$BIOS_DIR/PCE" "$BIOS_DIR/PKM" "$BIOS_DIR/PS" "$BIOS_DIR/PUAE" \
           "$BIOS_DIR/SGB" "$BIOS_DIR/PRBOOM/doom" "$BIOS_DIR/PRBOOM/doom-ultimate" \
           "$BIOS_DIR/PRBOOM/doom2" "$BIOS_DIR/PRBOOM/freedoom" "$BIOS_DIR/PRBOOM/freedoom1" \
           "$BIOS_DIR/PRBOOM/freedoom2" "$BIOS_DIR/PRBOOM/plutonia" "$BIOS_DIR/PRBOOM/tnt"
  
  download_file "$BIOS_DIR/FC" "$BASE_URL/Nintendo%20-%20Famicom%20Disk%20System/disksys.rom" "" "FC: disksys.rom"
  download_file "$BIOS_DIR/GB" "$BASE_URL/Nintendo%20-%20Gameboy/gb_bios.bin" "" "GB: gb_bios.bin"
  download_file "$BIOS_DIR/GBA" "$BASE_URL/Nintendo%20-%20Game%20Boy%20Advance/gba_bios.bin" "" "GBA: gba_bios.bin"
  download_file "$BIOS_DIR/GBC" "$BASE_URL/Nintendo%20-%20Gameboy%20Color/gbc_bios.bin" "" "GBC: gbc_bios.bin"
  
  download_file "$BIOS_DIR/MD" "$BASE_URL/Sega%20-%20Mega%20CD%20-%20Sega%20CD/bios_CD_E.bin" "" "MD: bios_CD_E.bin"
  download_file "$BIOS_DIR/MD" "$BASE_URL/Sega%20-%20Mega%20CD%20-%20Sega%20CD/bios_CD_J.bin" "" "MD: bios_CD_J.bin"
  download_file "$BIOS_DIR/MD" "$BASE_URL/Sega%20-%20Mega%20CD%20-%20Sega%20CD/bios_CD_U.bin" "" "MD: bios_CD_U.bin"
  
  local MGBA_LINK="$BIOS_DIR/MGBA/gba_bios.bin"
  local MGBA_TARGET="$BIOS_DIR/GBA/gba_bios.bin"
  if [[ $DRY_RUN -eq 1 ]]; then
    info "[DRY-RUN] Would create symlink: MGBA -> GBA BIOS"
    add_dl_done "MGBA: symlink (dry-run)"
  elif [[ -L "$MGBA_LINK" ]]; then
    local current_target
    current_target="$(readlink "$MGBA_LINK")"
    if [[ "$current_target" != "$MGBA_TARGET" ]]; then
      rm -f "$MGBA_LINK"
      ln -s "$MGBA_TARGET" "$MGBA_LINK"
      success "MGBA: symlink refreshed"
      add_dl_done "MGBA: symlink refreshed"
    else
      debug "MGBA: symlink already correct"
      add_dl_done "MGBA: symlink OK"
    fi
  elif [[ -e "$MGBA_LINK" ]]; then
    add_dl_done "MGBA: bios exists (kept)"
  else
    ln -s "$MGBA_TARGET" "$MGBA_LINK"
    success "MGBA: symlink created"
    add_dl_done "MGBA: symlink created"
  fi
  
  download_file "$BIOS_DIR/PCE" "$BASE_URL/NEC%20-%20PC%20Engine%20-%20TurboGrafx%2016%20-%20SuperGrafx/syscard3.pce" "" "PCE: syscard3.pce"
  download_file "$BIOS_DIR/PKM" "$BASE_URL/Nintendo%20-%20Pokemon%20Mini/bios.min" "" "PKM: bios.min"
  download_file "$BIOS_DIR/PRBOOM" "$BASE_URL/Id%20Software%20-%20Doom/prboom.wad" "" "PRBOOM: prboom.wad"
  
  download_file "$BIOS_DIR/PS" "https://github.com/gingerbeardman/PSX/raw/master/PSXONPSP660.BIN" "psxonpsp660.bin" "PS: psxonpsp660.bin"
  download_file "$BIOS_DIR/SGB" "https://raw.githubusercontent.com/Abdess/retroarch_system/libretro/Nintendo%20-%20Super%20Game%20Boy/sgb2.boot.rom" "sgb.bios" "SGB: sgb.bios"
  
  download_file "$BIOS_DIR/PUAE" "$BASE_URL/Commodore%20-%20Amiga/kick34005.A500" "" "PUAE: kick34005.A500"
  download_file "$BIOS_DIR/PUAE" "$BASE_URL/Commodore%20-%20Amiga/kick40063.A600" "" "PUAE: kick40063.A600"
  download_file "$BIOS_DIR/PUAE" "$BASE_URL/Commodore%20-%20Amiga/kick40068.A1200" "" "PUAE: kick40068.A1200"
  download_file "$BIOS_DIR/PUAE" "https://raw.githubusercontent.com/BatoceraPLUS/Batocera.PLUS-bios/main/Kickstart%20v3.1%20r40.68%20(1993)(Commodore)(A4000).rom" "kick40068.A4000" "PUAE: kick40068.A4000"
  
  if [[ $DRY_RUN -eq 0 ]]; then
    echo "Downloaded available Amiga Kickstarts. Missing variants must be added manually from legal sources like Amiga Forever." > "$BIOS_DIR/PUAE/README.txt"
  fi
  
  local PRBOOM_DIR="$BIOS_DIR/PRBOOM"
  local FREEDOOM_VERSION="0.13.0"
  local FREEDOOM_ARCHIVE="freedoom-${FREEDOOM_VERSION}.zip"
  local FREEDOOM_URL="https://github.com/freedoom/freedoom/releases/download/v${FREEDOOM_VERSION}/${FREEDOOM_ARCHIVE}"
  
  download_file "$PRBOOM_DIR" "$FREEDOOM_URL" "$FREEDOOM_ARCHIVE" "PRBOOM: FreeDoom ${FREEDOOM_VERSION}"
  
  if [[ $DRY_RUN -eq 0 ]]; then
    if [[ ! -f "$PRBOOM_DIR/freedoom1/freedoom1.wad" || ! -f "$PRBOOM_DIR/freedoom2/freedoom2.wad" ]]; then
      if [[ -f "$PRBOOM_DIR/$FREEDOOM_ARCHIVE" ]]; then
        unzip -n "$PRBOOM_DIR/$FREEDOOM_ARCHIVE" "freedoom-${FREEDOOM_VERSION}/freedoom1.wad" "freedoom-${FREEDOOM_VERSION}/freedoom2.wad" -d "$PRBOOM_DIR" 2>/dev/null || true
        mv -n "$PRBOOM_DIR/freedoom-${FREEDOOM_VERSION}/freedoom1.wad" "$PRBOOM_DIR/freedoom1/" 2>/dev/null || true
        mv -n "$PRBOOM_DIR/freedoom-${FREEDOOM_VERSION}/freedoom2.wad" "$PRBOOM_DIR/freedoom2/" 2>/dev/null || true
        rm -rf "$PRBOOM_DIR/freedoom-${FREEDOOM_VERSION}"
        success "FreeDoom WADs extracted"
        add_dl_done "PRBOOM: FreeDoom WADs extracted"
      fi
    else
      debug "FreeDoom WADs already present"
      add_dl_done "PRBOOM: FreeDoom WADs OK"
    fi
  fi
}

# =============================================================================
# Summary Report
# =============================================================================
print_summary() {
  header "Summary"
  
  if [[ $DL_DONE_COUNT -gt 0 ]]; then
    echo -e "${GREEN}BIOS Downloads Completed ($DL_DONE_COUNT):${NC}"
    echo -e "$DL_DONE" | while IFS= read -r item; do
      [[ -n "$item" ]] && echo "  ✓ $item"
    done
  fi
  
  if [[ $DL_FAILED_COUNT -gt 0 ]]; then
    echo -e "\n${RED}BIOS Downloads Failed ($DL_FAILED_COUNT):${NC}"
    echo -e "$DL_FAILED" | while IFS= read -r item; do
      [[ -n "$item" ]] && echo "  ✗ $item"
    done
    echo -e "${DIM}  Some files may be missing upstream. Re-run later or add manually.${NC}"
  fi
  
  if [[ $ROM_DONE_COUNT -gt 0 ]]; then
    echo -e "\n${GREEN}ROM Downloads Completed ($ROM_DONE_COUNT):${NC}"
    echo -e "$ROM_DONE" | while IFS= read -r item; do
      [[ -n "$item" ]] && echo "  ✓ $item"
    done
  fi
  
  if [[ $ROM_FAILED_COUNT -gt 0 ]]; then
    echo -e "\n${RED}ROM Downloads Failed ($ROM_FAILED_COUNT):${NC}"
    echo -e "$ROM_FAILED" | while IFS= read -r item; do
      [[ -n "$item" ]] && echo "  ✗ $item"
    done
    echo -e "${DIM}  Re-run with --resume or adjust filters.${NC}"
  fi
  
  echo
  if [[ $DL_FAILED_COUNT -eq 0 ]] && [[ $ROM_FAILED_COUNT -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}✓ All operations completed successfully!${NC}"
  else
    echo -e "${YELLOW}${BOLD}⚠ Some operations failed. See above for details.${NC}"
  fi
}

# =============================================================================
# Argument Parsing
# =============================================================================
parse_args() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      -h|--help)
        usage
        ;;
      -v|--version)
        show_version
        ;;
      -n|--dry-run)
        DRY_RUN=1
        shift
        ;;
      -q|--quiet)
        QUIET=1
        shift
        ;;
      --verbose)
        VERBOSE=1
        shift
        ;;
      -j|--jobs)
        JOBS="$2"
        shift 2
        ;;
      --jobs=*)
        JOBS="${1#*=}"
        shift
        ;;
      -f|--filter)
        FILTER="$2"
        shift 2
        ;;
      --filter=*)
        FILTER="${1#*=}"
        shift
        ;;
      --bios-only)
        BIOS_ONLY=1
        shift
        ;;
      --roms-only)
        ROMS_ONLY=1
        shift
        ;;
      --rom-sources=*)
        REQUESTED_SOURCES="${1#*=}"
        INTERACTIVE=0
        shift
        ;;
      --rom-systems=*)
        REQUESTED_SYSTEMS="${1#*=}"
        INTERACTIVE=0
        shift
        ;;
      --non-interactive)
        INTERACTIVE=0
        shift
        ;;
      --resume)
        RESUME=1
        shift
        ;;
      --verify)
        VERIFY=1
        shift
        ;;
      --retry-count=*)
        RETRY_COUNT="${1#*=}"
        shift
        ;;
      --preset=*)
        PRESET="${1#*=}"
        shift
        ;;
      --include-prerelease)
        INCLUDE_PRERELEASE=1
        shift
        ;;
      --include-unlicensed)
        INCLUDE_UNLICENSED=1
        shift
        ;;
      --config=*)
        CONFIG_FILE="${1#*=}"
        shift
        ;;
      -*)
        error "Unknown option: $1"
        echo "Run '$0 --help' for usage."
        exit 1
        ;;
      *)
        if [[ -z "$SDCARD_ROOT" ]]; then
          SDCARD_ROOT="$1"
        else
          error "Unexpected argument: $1"
          exit 1
        fi
        shift
        ;;
    esac
  done
}

# =============================================================================
# Main
# =============================================================================
main() {
  load_config
  parse_args "$@"
  
  if [[ -z "$SDCARD_ROOT" ]]; then
    error "No SD card path provided."
    echo "Run '$0 --help' for usage."
    exit 1
  fi
  
  if [[ ! -d "$SDCARD_ROOT" ]]; then
    error "Directory does not exist: $SDCARD_ROOT"
    exit 1
  fi
  
  check_dependencies
  normalize_jobs
  
  [[ ! -t 0 ]] && INTERACTIVE=0
  
  BIOS_DIR="$SDCARD_ROOT/Bios"
  ROMS_DIR="$SDCARD_ROOT/Roms"
  
  if [[ $RESUME -eq 1 ]] || [[ $VERIFY -eq 1 ]]; then
    init_manifest
  fi
  
  if [[ $DRY_RUN -eq 1 ]]; then
    echo -e "${YELLOW}${BOLD}═══ DRY RUN MODE ═══${NC}"
    echo "No files will be downloaded. Showing what would happen."
    echo
  fi
  
  echo -e "${BOLD}Brick SD Card Creator${NC} v${VERSION}"
  echo -e "Target: ${CYAN}$SDCARD_ROOT${NC}"
  echo -e "Jobs: ${CYAN}$JOBS${NC} parallel downloads"
  [[ -n "$FILTER" ]] && echo -e "Filter: ${CYAN}$FILTER${NC}"
  echo
  
  mkdir -p "$ROMS_DIR/FC" "$ROMS_DIR/GB" "$ROMS_DIR/GBA" "$ROMS_DIR/GBC" "$ROMS_DIR/MD" \
           "$ROMS_DIR/MGBA" "$ROMS_DIR/PCE" "$ROMS_DIR/PKM" "$ROMS_DIR/PRBOOM" "$ROMS_DIR/PS" \
           "$ROMS_DIR/PUAE" "$ROMS_DIR/SGB"
  
  if [[ $ROMS_ONLY -eq 0 ]]; then
    download_all_bios
  fi
  
  if [[ $BIOS_ONLY -eq 0 ]]; then
    run_selected_rom_downloads
  fi
  
  print_summary
  
  echo
  if [[ $DRY_RUN -eq 1 ]]; then
    info "Dry run complete. Run without --dry-run to actually download."
  else
    success "Setup complete!"
  fi
}

main "$@"