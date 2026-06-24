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

# --- installer output styling ----------------------------------------------
# Colors only when stdout is a terminal (true under `curl | bash`). Empty
# otherwise so piping to a file/log stays clean.
if [ -t 1 ]; then
    case "${COLORTERM:-}" in
        *truecolor*|*24bit*)   # 24-bit: exact Claude orange
            C_OR=$'\033[38;2;220;110;75m'
            PET_BG=$'\033[48;2;220;110;75m'; PET_EYE=$'\033[38;2;15;15;15m' ;;
        *)                     # 256-color fallback (e.g. macOS Terminal.app)
            C_OR=$'\033[38;5;208m'
            PET_BG=$'\033[48;5;208m'; PET_EYE=$'\033[38;5;232m' ;;
    esac
    C_GN=$'\033[32m'; C_YL=$'\033[33m'; C_DIM=$'\033[2m'; C_BD=$'\033[1m'; C_RS=$'\033[0m'
else
    C_OR=; C_GN=; C_YL=; C_DIM=; C_BD=; C_RS=; PET_BG=; PET_EYE=
fi
ok()   { printf '  %s✓%s %s\n' "$C_GN" "$C_RS" "$1"; }
warn() { printf '  %s⚠%s %s\n' "$C_YL" "$C_RS" "$1"; }

printf '\n  🐾 %s%sClaude Code Pet%s %s· Animated pet for your statusline%s\n\n' \
    "$C_BD" "$C_OR" "$C_RS" "$C_DIM" "$C_RS"

# --- 1. the pet (single self-contained mascot) --------------------------
cat > "$SC/claude-pet" <<'CLAUDE_PET_EOF'
#!/usr/bin/env bash
# claude-pet — animated Claude mascot for your Claude Code statusline.
#
# Modeled after the pixel-art Claude on claude.ai: a chunky orange body with
# two eyes that cycle through moods. The mascot reacts to context usage:
#   --mood 0  Relaxed    (0–40% context):  happy, playful expressions.
#   --mood 1  Exhausted  (41–69% context): strained/worried — your cue to compact.
#   --mood 2  Panic      (70%+ context):   dead-eyed ✖ ✖ stare — auto-compact is close.
#
# Each invocation prints ONE frame (exactly 5 terminal cells) chosen by
# weighted random, then exits. No state files, no forks — pure bash builtins.
# The animation comes from Claude Code re-invoking the command (~1 fps with
# refreshInterval:1); the randomness keeps the motion from looping.
#
# Usage:
#   claude-pet --statusline [--mood 0|1|2]   Print one frame and exit.
#   claude-pet --help                        Show help.
#
# Wire it into ~/.claude/settings.json:
#   "statusLine": {
#     "type": "command",
#     "command": "~/.claude/scripts/claude-pet --statusline",
#     "refreshInterval": 1
#   }
# (The bundled claude-pet-statusline.sh passes --mood based on context usage.)

set -u

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    cat <<'HELP'
claude-pet — animated Claude mascot for your Claude Code statusline

  claude-pet --statusline [--mood 0|1|2]   Prints one frame (5 cells) and exits.
  claude-pet --help                        Show this help.

--mood 0 (default) = relaxed pool; 1 = exhausted (compact cue); 2 = panic (70%+).
Each call picks a weighted-random frame, so the animation never loops.
Stateless: no temp files, no forks. Wire it into your statusline (see the
top of this file for settings.json).
HELP
    exit 0
fi

# --- Palette ---------------------------------------------------------------
case "${COLORTERM:-}" in        # body bg = Claude orange (match installer preview)
    *truecolor*|*24bit*) SBG=$'\033[48;2;220;110;75m' ;;
    *)                   SBG=$'\033[48;5;208m' ;;     # 256-color fallback
esac
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

# Exhausted pool (41–69%) — strained / worried: your cue to compact.
EXHAUSTED_SPECIALS=(
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
        else frame="${EXHAUSTED_SPECIALS[$(( RANDOM % ${#EXHAUSTED_SPECIALS[@]} ))]}"
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
# Claude Code statusLine script.
# Always renders the animated pet (mood from context %), then EITHER:
#   - built-in line: pet | model | cwd | git branch | context % | cache, or
#   - prepend mode:  pet + your own statusLine output — used when the installer
#     saved your previous command to scripts/.claude-pet-host-command.
# Either way the pet keeps all 3 moods, since mood is computed here.

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

# --- Prepend mode ----------------------------------------------------------
# If the installer saved the user's previous statusLine command (they chose
# "just add the pet"), render: pet + that command's output, pet in first
# position. The original JSON is re-fed on stdin (it was consumed above).
HOST_CMD_FILE="$HOME/.claude/scripts/.claude-pet-host-command"
host_cmd=""
[ -r "$HOST_CMD_FILE" ] && host_cmd=$(<"$HOST_CMD_FILE")

# Fork-bomb guard: never run a host command that points back at this wrapper
# (it would re-invoke us every render). Drop it and fall back to the built-in
# line — makes self-reference structurally impossible regardless of detection.
case "$host_cmd" in
    *claude-pet-statusline.sh*) host_cmd="" ;;
esac

if [ -n "$host_cmd" ]; then
    host_out=$(printf '%s' "$input" | sh -c "$host_cmd" 2>/dev/null)
    if [ -n "$pet" ]; then
        printf '%s %s\n' "$pet" "$host_out"
    else
        printf '%s\n' "$host_out"
    fi
    exit 0
fi

# --- Built-in line (complete mode) -----------------------------------------
# Truecolor (24-bit) codes. Using explicit RGB instead of 16-color slots
# (\033[36m etc.) keeps colors vivid regardless of the terminal theme — Warp
# and similar terminals map the 16 ANSI slots to a muted palette, which made
# these look washed out compared to macOS Terminal.
RESET='\033[0m'
DIM='\033[2m'
CYAN='\033[38;2;38;215;225m'
YELLOW='\033[38;2;255;200;60m'
GREEN='\033[38;2;80;220;100m'
RED='\033[38;2;255;85;85m'
BLUE='\033[38;2;90;160;255m'
SEP="${DIM} | ${RESET}"

# Build the display path. Collapse git-worktree paths
# (<repo>/.claude/worktrees/<name>/<subpath>) into "🌲  <repo>/<subpath>" — the
# branch field already shows the worktree name, so the long middle is just
# noise. Everything else gets the usual home-dir -> ~ shortening. Keep the raw
# absolute $cwd untouched: get_branch below walks it to find .git.
case "$cwd" in
    */.claude/worktrees/*)
        repo_root="${cwd%%/.claude/worktrees/*}"   # .../cloud-automation
        repo_name="${repo_root##*/}"               # cloud-automation
        rest="${cwd#*/.claude/worktrees/}"         # RED-xxx/e2e-automation/sm-ui-refresh
        subpath="${rest#*/}"                       # e2e-automation/sm-ui-refresh (or rest if at root)
        if [ "$subpath" = "$rest" ]; then
            cwd_display="🌲  ${repo_name}"         # worktree root, no subpath
        else
            cwd_display="🌲  ${repo_name}/${subpath}"
        fi
        ;;
    *)
        cwd_display="${cwd/#$HOME/~}"
        ;;
esac

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
get_branch "$cwd"

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
    result="${result}${SEP}${CYAN}${cwd_display}${RESET}"
else
    result="${CYAN}${cwd_display}${RESET}"
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

ok "pet     ${C_DIM}→ $SC/claude-pet${C_RS}"
ok "wrapper ${C_DIM}→ $SC/claude-pet-statusline.sh${C_RS}"

# Arrow-key dropdown for the "existing statusLine found" choice. Renders to
# /dev/tty and reads raw keystrokes from it (works under `curl | bash`). Up/Down
# (or k/j) move, Enter selects. Sets MENU_MODE to "complete" or "prepend".
# Written for Bash 3.2 (macOS): integer read timeouts only, no `mapfile`, etc.
menu_choice() {
    local existing="$1" sel=0 key rest i first=1
    local opts=("Replace it with the full pet line  (pet · model · dir · branch · ctx · cache)"
                "Keep my statusline — just add the pet in front")
    local n=${#opts[@]}
    # Restore the cursor on any exit/interrupt while the menu is open.
    trap 'printf "\033[?25h" > /dev/tty 2>/dev/null' EXIT INT TERM
    {
        printf '\n  %s%sAn existing statusLine was found:%s\n      %s%s%s\n\n' \
            "$C_BD" "$C_OR" "$C_RS" "$C_DIM" "$existing" "$C_RS"
        printf '  %sUse ↑/↓ then Enter:%s\n\n' "$C_DIM" "$C_RS"
        printf '\033[?25l'   # hide cursor
    } > /dev/tty
    while true; do
        [ "$first" -eq 0 ] && printf '\033[%dA' "$n" > /dev/tty   # cursor up n lines to redraw
        first=0
        for i in "${!opts[@]}"; do
            if [ "$i" -eq "$sel" ]; then
                printf '\033[K  %s%s ▸ %s %s\n' "$PET_BG" "$PET_EYE" "${opts[$i]}" "$C_RS" > /dev/tty   # selected: orange bg
            else
                printf '\033[K    %s%s%s\n' "$C_DIM" "${opts[$i]}" "$C_RS" > /dev/tty
            fi
        done
        IFS= read -rsn1 key < /dev/tty || true
        if [ "$key" = $'\033' ]; then
            IFS= read -rsn2 -t 1 rest < /dev/tty || true   # arrow tail: "[A"/"[B"
            key+="$rest"
        fi
        case "$key" in
            $'\033[A'|k) sel=$(( (sel - 1 + n) % n )) ;;
            $'\033[B'|j) sel=$(( (sel + 1) % n )) ;;
            ''|$'\n'|$'\r') break ;;   # Enter
        esac
    done
    printf '\033[?25h' > /dev/tty   # show cursor
    trap - EXIT INT TERM
    [ "$sel" -eq 1 ] && MENU_MODE="prepend" || MENU_MODE="complete"
}

# --- 3. wire into settings.json (backup first) --------------------------
# If a foreign statusLine already exists (or the pet is already prepending to
# one), offer a dropdown: replace it with the full pet line, or keep it and
# prepend the pet. Re-running lets you switch between the two.
SETTINGS="$CL/settings.json"
CMD="bash ~/.claude/scripts/claude-pet-statusline.sh"
HOST_CMD_FILE="$SC/.claude-pet-host-command"
if command -v jq >/dev/null 2>&1; then
  if [ -f "$SETTINGS" ]; then cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"; else echo '{}' > "$SETTINGS"; fi

  # Existing statusLine command, normalized (expand a leading ~, trim) so the
  # "is this already ours?" check is robust against ~ vs $HOME and whitespace.
  existing=$(jq -r '.statusLine.command // empty' "$SETTINGS" 2>/dev/null)
  norm_existing="${existing/#\~/$HOME}"
  norm_existing="${norm_existing#"${norm_existing%%[![:space:]]*}"}"

  # Work out the foreign statusLine we'd prepend to ($host_line) and whether to
  # offer the choice. When re-running over our own wrapper in prepend mode, the
  # user's real line lives in the host-command file — surface it so they can
  # switch to the full pet line (or stay) without uninstalling first.
  mode="complete"
  host_line=""
  offer=0
  if [ -n "$existing" ] && [[ "$norm_existing" == *claude-pet-statusline.sh* ]]; then
    if [ -s "$HOST_CMD_FILE" ]; then
      host_line=$(cat "$HOST_CMD_FILE")
      case "$host_line" in *claude-pet-statusline.sh*) host_line="" ;; esac   # never prepend to ourselves
    fi
    [ -n "$host_line" ] && offer=1     # currently prepending -> re-offer; else stay full
  elif [ -n "$existing" ]; then
    host_line="$existing"; offer=1     # foreign statusLine -> offer replace vs prepend
  fi

  if [ "$offer" -eq 1 ]; then
    if [ -r /dev/tty ]; then
      menu_choice "$host_line"     # sets MENU_MODE to complete|prepend
      mode="$MENU_MODE"
    else
      mode="prepend"   # non-interactive with a line present: don't clobber it
    fi
  fi

  case "$mode" in
    prepend) printf '%s' "$host_line" > "$HOST_CMD_FILE"
             ok "existing statusLine kept — pet prepended in first position" ;;
    complete) rm -f "$HOST_CMD_FILE" ;;     # full pet line
  esac

  tmp="$(mktemp)"
  jq --arg cmd "$CMD" '.statusLine={type:"command",command:$cmd,refreshInterval:1}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  ok "statusLine wired ${C_DIM}→ $SETTINGS${C_RS} (backup kept)"
else
  warn "jq not found — add this to $SETTINGS manually:"
  printf '      %s"statusLine": { "type": "command", "command": "%s", "refreshInterval": 1 }%s\n' "$C_DIM" "$CMD" "$C_RS"
  printf '    %s(jq is also needed at runtime for context-aware mood — install via brew/apt.)%s\n' "$C_DIM" "$C_RS"
fi

# --- 4. preview ----------------------------------------------------------
# One pet, rendered exactly as it appears in the statusline (relaxed idle
# frame in the Claude-orange body) — no mood gallery.
preview_pet="${PET_BG} ${PET_EYE}● ●${PET_BG}${C_RS} "
printf '\n  %syour pet%s   %s\n\n' "$C_DIM" "$C_RS" "$preview_pet"
printf '  %s%sDone%s %s🐾%s  Start a new Claude Code session (or wait for the next redraw).\n\n' \
    "$C_BD" "$C_GN" "$C_RS" "$C_OR" "$C_RS"
