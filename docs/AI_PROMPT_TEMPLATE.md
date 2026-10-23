# 🤖 Universal AI Collaboration Prompt

> **How to use:** Copy and paste this context into any AI collaborator (ChatGPT, Claude, Gemini, DeepSeek). It provides full system awareness without imposing rigid command restrictions.

---

### ARCHITECTURAL CONTEXT
- **Operating System:** Fedora Workstation 44 (GNOME 50 on Wayland)
- **Repository:** https://github.com/MehulK-techie/fedora-workstation-config (Branch: `main`)
- **Local Path:** wherever the repo was cloned (the `mk` CLI records it in `~/.config/mk-workstation/repo-path`)
- **Script roles:** `setup.sh` (root: DNF, RPM Fusion, Flatpaks, Howdy) → runs `sync.sh` as the user (the single source of all GNOME settings); `register-face.sh` (face unlock wizard + PAM); `mk export` saves settings and extensions into `config/`

### ACTIVE EXTENSIONS (16, listed in `config/enabled-extensions.txt`, settings in `config/extension-settings/`)
Touchpad Gesture Customization, Blur my Shell, Astra Monitor, Clipboard Indicator, Transparent Top Bar, WACK Lockscreen Clock, WACK Shell, Text Extractor, Places Status Indicator, Dash to Dock, AppIndicator, Caffeine, Tiling Assistant, Magic Lamp, Impatience, Burn My Windows, plus the project's own `mk-indicator@mehulk`.

### KEYBINDING & UTILITY MATRIX
- `Super + Shift + T` / `Super + Alt + T` : OCR (`ocr-snip` via the screenshot portal / Text Extractor)
- `Super + V` : Clipboard history
- Windows/macOS keymap: Super+E/I/D/R/S, Ctrl+Shift+Esc, Super+1-9 dock apps, Super+Shift+3/4 screenshots, Ctrl+Alt+T terminal, Super+Alt+1-4 workspaces, Super+Ctrl+D new desktop (full table in README)
- Touchpad: 4 fingers ←/→ workspaces, 3 fingers ←/→ windows, 3 fingers ↑ overview, 4-finger pinch show desktop
- `Super + .` : Emoji Board (GNOME Characters)
- `Super + /` : Live Shortcuts HUD
- `Super + N` : Obsidian · `Super + B` : default browser · `Super + Shift + N` : Quick Notes & Focus Timer
- `Super + Z` : snap layouts · `Super + ←/→` then `↑/↓` : quarters · `Super + Ctrl + T` : always on top
- `mk update` (update everything) · `mk save` (capture what you added)
- `Super + C` : Camera Controls Studio
- `Alt + Tab` / `Super + Tab` : Window switcher across all workspaces / app switcher
- `Super + Backspace` / `Super + Shift + X` : Shut down dialog
- `Ctrl + Alt + ←/→` : left free for Zen Browser workspaces
- Face unlock: Howdy (`pam_howdy.so`) on GDM; sudo opt-in on RGB cameras; multi-model wizard `register-face.sh` / `mk face`
- Health check: `mk doctor`

---

### COLLABORATION GUIDELINES
Use this context as background knowledge. Feel free to adapt flexibly to any request, creative workflow, optimization, or troubleshooting intent with full creative freedom. Scripts must stay idempotent, back up system files before editing, and route root-run gsettings through `as_user()` (see `CLAUDE.md` in the repo root).

---

### MY TASK / QUESTION:
[Insert your question or request here]

---

For installation and dual-boot preparation steps, see [GUIDE.md](GUIDE.md).
