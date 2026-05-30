# 🐾 claude-pet

> A pixel-art Claude that lives in your statusline and tells you — through sheer existential dread — when it's time to `/compact`.

## What is it?

A self-contained Bash script that prints one **5-cell mascot frame** every time Claude Code refreshes your statusline (about once a second). It blinks, glances, and emotes — a pixel-art Claude with a chunky orange body — and reacts to how full your context window is.

The animation isn't a fixed loop: each refresh picks a **weighted-random** frame, so the pet feels alive rather than metronomic.
<p align="center">
  <img src="./assets/claude-pet.gif" alt="claude-pet" width="720">
</p>

<h3 align="center">
  <a href="https://amirya412.github.io/claude-code-pet/">▶ Try the interactive demo</a>
</h3>

## Why it's nice

- **Zero forks, zero temp files.** Pure Bash builtins + `$RANDOM`.
- **Never loops.** Weighted-random frames feel alive, not robotic.
- **Context-aware.** Three tiers — relaxed (0–40%), exhausted (41–69%), panic (70%+) — a building nudge to `/compact`.
- **No jitter.** Every frame is exactly 5 terminal cells wide.
- **One file.** Drop it in, point your statusline at it.
- **Mostly idle.** It rests, blinks, and glances far more than it emotes.

## Expressions

The pet has three moods, switched by context-window usage:

- 🙂 **Relaxed** (`0–40%`) — happy & playful. Emotes roughly every 6 seconds.
- 😩 **Exhausted** (`41–69%`) — strained. Emotes more often (~every 4.5 s) — your cue to compact.
- 💀 **Panic** (`70%+`) — a dead-eyed `✖ ✖` stare (no more blinking). Auto-compact is closing in.

> [!WARNING]
> Past **41%** the pet looks exhausted; past **70%** it flips to a panic `✖ ✖` stare — your signal to `/compact` before auto-compact kicks in around 95%.

Here's the full cast:

<p align="center">
  <img src="./assets/claude-pet-faces.png" alt="claude-pet" width="720">
</p>


## Install

### Requirements

- **[Claude Code CLI](https://docs.claude.com/en/docs/claude-code)** (`npm install -g @anthropic-ai/claude-code`)
- **[`jq`](https://jqlang.github.io/jq/)** — required for the installer (①) and the context-aware wrapper; it parses the statusline JSON on every redraw. (Only optional if you wire the bare pet manually via ② / ③, which is pure Bash.) Install with `brew install jq` (macOS) or `sudo apt install jq` (Debian/Ubuntu).
- **Bash ≥ 3.2** — the pet and wrapper are Bash scripts (ships with macOS and Linux).
- **A Modern Terminal** - For color support. 

### ① One line — installer script

```bash
curl -fsSL https://raw.githubusercontent.com/AmirYa412/claude-code-pet/main/claude-pet-install.sh | bash
```

Or, if you've cloned the repo:

```bash
bash claude-pet-install.sh
```

Drops the pet + a statusline wrapper into `~/.claude` and wires `settings.json` (with a timestamped backup). Idempotent. Needs [`jq`](https://jqlang.github.io/jq/).


### ② Manual

```bash
# copy the pet into place and make it runnable
mkdir -p ~/.claude/scripts
cp claude-pet ~/.claude/scripts/
chmod +x ~/.claude/scripts/claude-pet
```

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/scripts/claude-pet --statusline",
    "refreshInterval": 1
  }
}
```

> [!IMPORTANT]
> `refreshInterval: 1` is what animates it — Claude Code re-runs the command every second.

### ③ Just ask Claude

Paste this into a Claude Code session:

```
Set up ~/.claude/scripts/claude-pet as my statusline:
chmod +x it, and add a "statusLine" to ~/.claude/settings.json
of type "command" running "~/.claude/scripts/claude-pet
--statusline" with "refreshInterval": 1.
```

> [!NOTE]
> The context-aware mood switch (relaxed ↔ exhausted) is driven by a small statusline wrapper that the installer (①) sets up for you — it reads the current context % and passes it to the pet. Pointing your statusline straight at `claude-pet` (② / ③) still gives you the fully animated pet, in its relaxed mood.

---

<p align="center"><sub>Made with 🐾 for Claude Code statuslines.</sub></p>
