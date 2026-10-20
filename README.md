# 🐾 Claude Code Pet

> A pixel-art Claude that tells you — through sheer existential dread — when it's time to `/compact`.

A tiny orange Claude that lives next to your prompt, blinks, glances and emotes, and gets more and more stressed as your context window fills up. It comes in two flavors:

- **[⌨️ Terminal](#terminal)** — a Bash statusline for Claude Code in your terminal.
- **[🖥️ Claude Desktop app](#desktop)** — a plugin that puts the pet above the prompt in the desktop app's Code tab, and also reacts to what Claude is doing.

## 🎭 Moods

Both versions share the same three moods, switched by context-window usage:

| Mood | Context | Look |
| :- | :- | :- |
| 🙂 **Relaxed** | `0–40%` | Happy and playful, emotes about every 12 s |
| 😩 **Exhausted** | `41–69%` | Heavy eyelids, emotes more often — your cue to compact |
| 💀 **Panic** | `70%+` | `✖ ✖` eyes, blinking fast and rattled |

> [!WARNING]
> Past **70%** the pet panics: `/compact` before auto-compact kicks in around 95%.

<p align="center">
  <img src="./assets/claude-desktop-pet-moods.gif" alt="Relaxed, exhausted and panic moods" width="820">
</p>

<a id="terminal"></a>
## ⌨️ Terminal · Bash statusline

One self-contained Bash script prints a **5-cell mascot frame** each time Claude Code refreshes your statusline (about once a second).

<p align="center">
  <img src="./assets/claude-pet.gif" alt="claude-pet in the terminal statusline" width="720">
</p>

<h3 align="center">
  <a href="https://amirya412.github.io/claude-code-pet/">▶ Try the interactive demo</a>
</h3>

- **Zero forks, zero temp files.** Pure Bash builtins and a seeded integer hash.
- **Never loops.** Each second gets a weighted-random frame: double blinks, glances that linger, emotes that never repeat back to back.
- **No jitter.** Every frame is exactly 5 terminal cells wide.

<p align="center">
  <img src="./assets/claude-pet-faces.png" alt="The terminal pet's faces" width="720">
</p>

### Install

#### Requirements

- **[Claude Code](https://code.claude.com/docs)** — Anthropic's CLI; see the docs to install.
- **[`jq`](https://jqlang.github.io/jq/)** — **required**: the installer edits `settings.json` with it, and the statusline wrapper parses the context JSON on every redraw. Install with `brew install jq` (macOS) or `sudo apt install jq` (Debian/Ubuntu).
- **Bash ≥ 3.2** — the pet and wrapper are Bash scripts (macOS/Linux have it; on **Windows** run the install in **Git Bash or WSL**, not PowerShell).
- **A modern terminal** — for color support.

#### One command

```bash
curl -fsSL https://raw.githubusercontent.com/AmirYa412/claude-code-pet/main/claude-pet-install.sh | bash
```

Cloned the repo instead? Run `bash claude-pet-install.sh`.

It drops the pet **and** the statusline wrapper into `~/.claude` and wires `settings.json` (`refreshInterval: 1`, which drives the ~1 fps animation) with a timestamped backup.

> [!NOTE]
> **Already have a statusline?** The installer detects it and shows an arrow-key menu (**↑/↓ then Enter**):
> - **Replace it with the full pet line** — pet · model · directory · git branch · context %.
> - **Keep your statusline and add the pet in front** — the pet still cycles all three moods.
>
> A timestamped backup of `settings.json` is kept either way. Fresh installs (no existing statusline) go straight to the full line with no menu.

<a id="desktop"></a>
## 🖥️ Claude Desktop app

[`pixel-pet`](./desktop-pet) is a Claude Code plugin that draws the pet above the prompt in the desktop app (Code tab), beside **model · dir · branch · CTX bar · cost**.

<p align="center">
  <img src="./assets/claude-desktop-pet.png" alt="pixel-pet above the prompt in the Claude desktop app" width="820">
</p>

- **Reacts to Claude**: greets your messages, then works along with each tool, with two animations per tool picked at random. A few of them: 🔨 edit, ✏️ write, 🔍 read, 🌐 web, ⌨️ bash, 🚀 push, 🧹 cleanup, 🧪 tests (green or red).
- **Live statusline**: CTX bar and session cost. The bar refills right after `/compact`.
- **Light**: animations run in the app's renderer; the plugin redraws only on events, never on a timer.

### Install

**Desktop app**: **+** → **Plugins** → **Add marketplace** `AmirYa412/claude-code-pet` → add **pixel-pet**. Or from a terminal:

```bash
claude plugin install pixel-pet --marketplace AmirYa412/claude-code-pet
```

Update with `claude plugin update pixel-pet`. It shows in the desktop app only: terminal sessions keep the Bash statusline, and Cowork doesn't load plugins.

---

<p align="center"><sub>Made with 🐾 for Claude Code.</sub></p>
