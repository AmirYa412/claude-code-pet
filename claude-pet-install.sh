#!/usr/bin/env bash
# claude-pet installer 🐾
# Drops the animated mascot + statusline wrapper into ~/.claude and wires it
# into settings.json (with a timestamped backup). Idempotent — safe to re-run.
#
#   curl -fsSL <url> | bash      # if hosted
#   bash claude-pet-install.sh   # if you have the file
set -euo pipefail

CL="$HOME/.claude"; SC="$CL/scripts"
mkdir -p "$SC"

# --- 1. the pet (single self-contained mascot) --------------------------
cat > "$SC/claude-pet" <<'CLAUDE_PET_EOF'
#!/usr/bin/env bash
# claude-pet — animated Claude mascot for your Claude Code statusline.
#
# Modeled after the pixel-art Claude on claude.ai: a chunky orange body with
# two eyes that cycle through moods. The mascot reacts to context usage:
#   --mood 0  Relaxed  (0–40% context): happy, playful expressions.
#   --mood 1  Focused  (41%+ context):  strained/worried — your cue to compact.
#
# Each invocation prints ONE frame (exactly 5 terminal cells) chosen by
# weighted random, then exits. No state files, no forks — pure bash builtins.
# The animation comes from Claude Code re-invoking the command (~1 fps with
# refreshInterval:1); the randomness keeps the motion from looping.
#
# Usage:
#   claude-pet --statusline [--mood 0|1]   Print one frame and exit.
#   claude-pet --help                      Show help.
#
# Wire it into ~/.claude/settings.json:
#   "statusLine": {
#     "type": "command",
#     "command": "~/.claude/scripts/claude-pet --statusline",
#     "refreshInterval": 1
#   }
# (The bundled statusline-command.sh passes --mood based on context usage.)

set -u

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'HELP'
claude-pet — animated Claude mascot for your Claude Code statusline

  claude-pet --statusline [--mood 0|1]   Prints one frame (5 cells) and exits.
  claude-pet --help                      Show this help.

--mood 0 (default) = relaxed/happy pool; --mood 1 = focused/worried pool.
Each call picks a weighted-random frame, so the animation never loops.
Stateless: no temp files, no forks. Wire it into your statusline (see the
top of this file for settings.json).
HELP
    exit 0
fi

# --- Palette ---------------------------------------------------------------
SBG=$'\033[48;2;220;110;75m'    # body bg = Claude orange
SOR=$'\033[38;2;220;110;75m'    # Claude orange (fg — Anthropic logo deco)
SEY=$'\033[38;2;15;15;15m'      # eye fg = near-black
SSP=$'\033[38;2;255;215;120m'   # sparkle yellow
SHT=$'\033[38;2;240;100;120m'   # heart pink
SRD=$'\033[38;2;235;45;70m'     # heart red (heart-eyes)
SZZ=$'\033[38;2;180;180;180m'   # zzz grey
SWT=$'\033[38;2;120;180;230m'   # sweat pale-blue
R=$'\033[0m'

# --- Frames ----------------------------------------------------------------
# Every frame is exactly 5 visible cells: a 4-cell orange body (space, eye,
# space, eye) + a 1-cell deco slot (a glyph like ✦ ♡ ! z ° ?, or a
# transparent space). Keeping the width fixed avoids layout jitter.

# Idle, blink, glance. Each mood has its own idle/glance; blink is shared.
IDLE="${SBG} ${SEY}● ●${SBG}${R} "                  # default pose (relaxed)
IDLE_F="${SBG} ${SEY}◒ ◒${SBG}${R} "                # default pose (exhausted, half-shaded)
IDLE_P="${SBG} ${SEY}✖ ✖${SBG}${R} "                # default pose (panic, crossed-out)
BLINK="${SBG} ${SEY}▬ ▬${SBG}${R} "                 # eyes shut (bold bars) — shared
LOOK_L="${SBG}${SEY}● ●${SBG} ${R} "                # glance left (relaxed)
LOOK_L_F="${SBG}${SEY}◒ ◒${SBG} ${R} "              # glance left (exhausted)
LOOK_L_P="${SBG}${SEY}✖ ✖${SBG} ${R} "              # glance left (panic)

# Relaxed pool (0–40%) — happy / playful.
RELAXED_SPECIALS=(
    "${SBG} ${SEY}^ ^${SBG}${R}${SSP}✦${R}"         # happy + sparkle
    "${SBG} ${SEY}▬ ●${SBG}${R} "                   # wink left
    "${SBG} ${SEY}● ▬${SBG}${R} "                   # wink right
    "${SBG} ${SEY}● ●${SBG}${R}${SHT}♥${R}"         # heart
    "${SBG} ${SEY}~ ~${SBG}${R}${SSP}✦${R}"         # zen + sparkle
    "${SBG} ${SEY}✱ ✱${SBG}${R}${SSP}✦${R}"         # starry + sparkle
    "${SBG} ${SEY}● ●${SBG}${R}${SSP}?${R}"         # curious
    "${SBG} ${SEY}◡ ◡${SBG}${R}${SSP}☼${R}"         # soft smile + sun
    "${SBG} ${SEY}◉ ◉${SBG}${R}${SSP}✦${R}"         # excited
    "${SBG} ${SEY}^ ^${SBG}${R}${SSP}♪${R}"         # giggle
    "${SBG} ${SRD}♥ ♥${SBG}${R} "                   # heart-eyes (smitten, red)
    "${SBG} ${SEY}^ ^${SBG}${R}${SSP}♫${R}"         # humming
    "${SBG} ${SEY}◠ ◠${SBG}${R} "                   # content
    "${SBG} ${SSP}★ ★${SBG}${R} "                   # starstruck (star eyes)
    "${SBG} ${SEY}◉ ◉${SBG}${R}${SOR}❋${R}"         # proud — Anthropic logo
)

# Panic pool (70%+) — system overload: auto-compact is close.
PANIC_SPECIALS=(
    "${SBG} ${SEY}✖ ✖${SBG}${R}${SRD}!${R}"          # alarm
    "${SBG} ${SEY}✖ ✖${SBG}${R}${SRD}@${R}"          # dizzy / overwhelmed
    "${SBG} ${SEY}✖ ✖${SBG}${R}${SRD}/${R}"          # swipe / "no"
    "${SBG} ${SEY}✖ ✖${SBG}${R}${SRD}X${R}"          # struck / error (red X)
)

# Focused pool (41–69%) — strained / worried: your cue to compact.
FOCUSED_SPECIALS=(
    "${SBG} ${SEY}> <${SBG}${R} "                   # squint / strain
    "${SBG} ${SEY}o o${SBG}${R}${SSP}!${R}"         # surprised
    "${SBG} ${SEY}▬ ▬${SBG}${R}${SZZ}z${R}"         # sleepy (bold bars)
    "${SBG} ${SEY}◒ ◒${SBG}${R}${SWT}°${R}"         # sweat drop (focused eyes)
    "${SBG} ${SEY}• •${SBG}${R} "                   # focused / narrowed
    "${SBG} ${SEY}o o${SBG}${R}${SWT}°${R}"         # panic (wide + sweat)
    "${SBG} ${SEY}✖ ✖${SBG}${R} "                   # overload (crossed-out)
    "${SBG} ${SEY}> <${SBG}${R}${SWT}°${R}"         # strained + sweat
    "${SBG} ${SEY}▮ ▮${SBG}${R} "                   # rigid / bracing stare
    "${SBG} ${SEY}. .${SBG}${R}${SSP}◗${R}"         # tiny / wistful + filled moon
)

# --- Statusline mode -------------------------------------------------------
# Pick one weighted-random frame for the given mood and print it. Weights
# favour idle/blink/glance so the pet mostly "lives" and only occasionally
# emotes. $RANDOM is a builtin — no fork, no file I/O.
if [[ "${1:-}" == "--statusline" || "${1:-}" == "-s" ]]; then
    shift
    mood=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --mood=*) mood="${1#--mood=}" ;;
            --mood)   mood="${2:-0}"; shift ;;
        esac
        shift
    done
    [[ "$mood" =~ ^[012]$ ]] || mood=0

    roll=$(( RANDOM % 100 ))
    if [[ "$mood" == "2" ]]; then
        # Panic: idle 64 / glance 20 / specials 16 (70%+, no blink — dead stare)
        if   (( roll < 64 )); then frame="$IDLE_P"
        elif (( roll < 84 )); then frame="$LOOK_L_P"
        else frame="${PANIC_SPECIALS[$(( RANDOM % ${#PANIC_SPECIALS[@]} ))]}"
        fi
    elif [[ "$mood" == "1" ]]; then
        # Exhausted: idle 44 / blink 20 / glance 14 / specials 22 (41–69%, compact signal, ~4.5s)
        if   (( roll < 44 )); then frame="$IDLE_F"
        elif (( roll < 64 )); then frame="$BLINK"
        elif (( roll < 78 )); then frame="$LOOK_L_F"
        else frame="${FOCUSED_SPECIALS[$(( RANDOM % ${#FOCUSED_SPECIALS[@]} ))]}"
        fi
    else
        # Relaxed: idle 50 / blink 20 / glance 14 / specials 16 (0–40%)
        if   (( roll < 50 )); then frame="$IDLE"
        elif (( roll < 70 )); then frame="$BLINK"
        elif (( roll < 84 )); then frame="$LOOK_L"
        else frame="${RELAXED_SPECIALS[$(( RANDOM % ${#RELAXED_SPECIALS[@]} ))]}"
        fi
    fi

    printf '%s' "$frame"
    exit 0
fi

# Unknown invocation
printf 'claude-pet: pass --statusline (or --help)\n' >&2
exit 1
CLAUDE_PET_EOF
chmod +x "$SC/claude-pet"

# --- 2. statusline wrapper (pet + model + cwd + branch + ctx% + cache) ---
cat > "$SC/claude-pet-statusline.sh" <<'CLAUDE_PET_WRAPPER_EOF'
#!/usr/bin/env bash
# Claude Code statusLine script
# Displays: pet | model | cwd | git branch | context usage % | cache hit

input=$(cat)

# Parse all fields in a single jq pass (one fork instead of four). Each field
# is emitted on its own line; IFS= preserves values verbatim (no trimming).
{
    IFS= read -r cwd
    IFS= read -r used
    IFS= read -r model
    IFS= read -r cache_read
    IFS= read -r session_id
} < <(jq -r '
    .cwd // .workspace.current_dir // "",
    .context_window.used_percentage // "",
    .model.display_name // (.model.id | ltrimstr("claude-")) // "",
    (.context_window.current_usage.cache_read_input_tokens // 0),
    .session_id // ""
' <<< "$input")

# Context usage is null on most idle renders, so cache the last-known value
# per session (fork-free read/write) — keeps the pet's mood and the ctx text
# steady instead of flickering. Then derive the mood: 0 = relaxed (0-40%),
# 1 = exhausted (41-69%), 2 = panic (70%+).
safe_session="${session_id//[^A-Za-z0-9_-]/}"
ctx_cache="${TMPDIR:-/tmp}/claude-statusline.ctx${safe_session:+.$safe_session}"
if [ -n "$used" ]; then
    printf '%s\n' "$used" > "$ctx_cache" 2>/dev/null
elif [ -r "$ctx_cache" ]; then
    read -r used < "$ctx_cache"
fi

used_int=""
mood=0
if [ -n "$used" ]; then
    used_int=$(printf '%.0f' "$used")
    [ "$used_int" -ge 41 ] && mood=1
    [ "$used_int" -ge 70 ] && mood=2
fi

# Animated Claude mascot prefix. Pass the mood (from context usage) so the pet
# shifts from happy to worried as the window fills. The pet picks its frame by
# weighted random, so it animates without any per-window state of its own.
pet=$(~/.claude/scripts/claude-pet --statusline --mood "$mood" 2>/dev/null)

# ANSI color codes
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
YELLOW='\033[33m'
GREEN='\033[32m'
RED='\033[31m'
BLUE='\033[34m'
SEP="${DIM} | ${RESET}"

# Shorten home directory to ~
cwd="${cwd/#$HOME/~}"

# Resolve the git branch without spawning git. Walk up from the dir to the
# .git entry, then read HEAD: a branch ref ("ref: refs/heads/x") or, when
# detached, a short SHA. Pure builtins — no fork. Handles worktrees, where
# .git is a file ("gitdir: <path>") rather than a directory.
get_branch() {
    local dir="$1" gitdir head
    branch=""
    while [ -n "$dir" ]; do
        if [ -d "$dir/.git" ]; then
            gitdir="$dir/.git"; break
        elif [ -f "$dir/.git" ]; then
            read -r _ gitdir < "$dir/.git"                          # "gitdir: <path>"
            [ "${gitdir#/}" = "$gitdir" ] && gitdir="$dir/$gitdir"  # relative -> absolute
            break
        fi
        dir="${dir%/*}"
    done
    [ -n "$gitdir" ] && [ -r "$gitdir/HEAD" ] || return
    read -r head < "$gitdir/HEAD"
    case "$head" in
        "ref: refs/heads/"*) branch="${head#ref: refs/heads/}" ;;
        ?*)                  branch="${head:0:7}" ;;   # detached HEAD -> short SHA
    esac
}
get_branch "${cwd/#~/$HOME}"

# Context usage color: green < 50%, yellow < 80%, red >= 80%
ctx_color="$GREEN"
if [ -n "$used_int" ]; then
    if [ "$used_int" -ge 80 ]; then
        ctx_color="$RED"
    elif [ "$used_int" -ge 50 ]; then
        ctx_color="$YELLOW"
    fi
fi

# Build result
result=""

if [ -n "$pet" ]; then
    # Pet's 5th cell (decoration slot) serves as the gap to the model.
    result="${pet}"
fi

if [ -n "$model" ]; then
    result="${result} ${YELLOW}${model}${RESET}"
fi

if [ -n "$result" ]; then
    result="${result}${SEP}${CYAN}${cwd}${RESET}"
else
    result="${CYAN}${cwd}${RESET}"
fi

if [ -n "$branch" ]; then
    result="${result}${SEP}${BLUE}${branch}${RESET}"
fi

if [ -n "$used" ]; then
    result="${result}${SEP}${ctx_color}ctx: ${used_int}%${RESET}"
fi

# Cache hit/miss indicator
if [ "$cache_read" -gt 0 ] 2>/dev/null; then
    result="${result}${SEP}${GREEN}cache: ✓${RESET}"
else
    result="${result}${SEP}${DIM}cache: –${RESET}"
fi

echo -e "$result"
CLAUDE_PET_WRAPPER_EOF
chmod +x "$SC/claude-pet-statusline.sh"

echo "  ✓ pet     -> $SC/claude-pet"
echo "  ✓ wrapper -> $SC/claude-pet-statusline.sh"

# --- 3. wire into settings.json (backup first) --------------------------
SETTINGS="$CL/settings.json"
CMD="bash ~/.claude/scripts/claude-pet-statusline.sh"
if command -v jq >/dev/null 2>&1; then
  if [ -f "$SETTINGS" ]; then cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"; else echo '{}' > "$SETTINGS"; fi
  tmp="$(mktemp)"
  jq --arg cmd "$CMD" '.statusLine={type:"command",command:$cmd,refreshInterval:1}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "  ✓ statusLine wired in $SETTINGS (backup kept)"
else
  echo "  ⚠ jq not found — add this to $SETTINGS manually:"
  echo "      \"statusLine\": { \"type\": \"command\", \"command\": \"$CMD\", \"refreshInterval\": 1 }"
  echo "    (jq is also needed at runtime for context-aware mood — install via brew/apt.)"
fi

# --- 4. preview ----------------------------------------------------------
printf '\n  preview  '; "$SC/claude-pet" --statusline --mood 0 2>/dev/null || true; printf '  relaxed\n'
printf '\n  preview  '; "$SC/claude-pet" --statusline --mood 1 2>/dev/null || true; printf '  exhausted\n'
printf '\n  preview  '; "$SC/claude-pet" --statusline --mood 2 2>/dev/null || true; printf '  panic\n'
echo
echo "Done 🐾  Start a new Claude Code session (or wait for the next redraw)."
