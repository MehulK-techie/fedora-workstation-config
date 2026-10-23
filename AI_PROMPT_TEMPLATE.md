# 🤖 Universal AI Collaboration Prompt

> **How to use:** Copy and paste this context into any AI collaborator (ChatGPT, Claude, Gemini, DeepSeek). It provides full system awareness without imposing rigid command restrictions.

---

### ARCHITECTURAL CONTEXT
- **Operating System:** Fedora Workstation 44 (GNOME 50 on Wayland)
- **Repository:** https://github.com/MehulK-techie/fedora-workstation-config (Branch: `main`)
- **Local Path:** wherever the repo was cloned (the `mk` CLI records it in `~/.config/mk-workstation/repo-path`)
- **Script roles:** `setup.sh` (root: DNF, RPM Fusion, Flatpaks, Howdy) → runs `sync.sh` as the user (the single source of all GNOME settings); `register-face.sh` (Howdy enrollment + PAM); `mk export` dumps settings into `config/`

### ACTIVE EXTENSIONS (8, set in `sync.sh`)
1. Touchpad Gesture Customization (`touchpad-gesture-customization@coooolapps.com`)
2. Blur my Shell (`blur-my-shell@aunetx`)
3. Astra Monitor (`monitor@astraext.github.io`)
4. Transparent Top Bar (`transparent-top-bar@ftpix.com`)
5. WACK Shell (`wack-shell@rinzler69-wastaken.github.com`)
6. Text Extractor (`text-extractor@imshaaz21.github.com`)
7. Places Status Indicator (`places-menu@gnome-shell-extensions.gcampax.github.com`)
8. Dash to Dock (`dash-to-dock@micxgx.gmail.com`)

### KEYBINDING & UTILITY MATRIX
- `Super + Shift + T` : OCR Screen Snip Extractor (`ocr-snip`, via the screenshot portal)
- `Super + .` : Emoji Board (GNOME Characters)
- `Super + /` : Live Shortcuts HUD
- `Super + N` : Quick Notes & Focus Timer
- `Super + C` : Camera Controls Studio
- `Alt + Tab` / `Super + Tab` : Window switcher across all workspaces / app switcher
- `Super + Backspace` / `Super + Shift + X` : Shut down dialog
- `Ctrl + Alt + ←/→` : left free for Zen Browser workspaces
- Face unlock: Howdy (`pam_howdy.so`) on GDM and sudo

---

### COLLABORATION GUIDELINES
Use this context as background knowledge. Feel free to adapt flexibly to any request, creative workflow, optimization, or troubleshooting intent with full creative freedom. Scripts must stay idempotent, back up system files before editing, and route root-run gsettings through `as_user()` (see `CLAUDE.md`).

---

### MY TASK / QUESTION:
[Insert your question or request here]

---

For installation and dual-boot preparation steps, see [GUIDE.md](GUIDE.md).
