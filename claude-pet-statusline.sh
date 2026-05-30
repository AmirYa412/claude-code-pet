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
