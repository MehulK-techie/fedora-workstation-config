# 🤖 Universal AI Collaboration Prompt

> **How to use:** Copy and paste this context into any AI collaborator (ChatGPT, Claude, Gemini, DeepSeek). It provides full system awareness without imposing rigid command restrictions.

---

### ARCHITECTURAL CONTEXT
- **Operating System:** Fedora Workstation (GNOME Shell on Wayland)
- **Repository:** https://github.com/MehulK-techie/fedora-workstation-config (Branch: `main`)
- **Local Path:** `~/Desktop/Fedora_workspace_MK`

### ACTIVE EXTENSIONS (13 TOTAL)
1. Astra Monitor (`monitor@astraext.github.io`)
2. Blur my Shell (`blur-my-shell@aunetx`)
3. Clipboard Indicator (`clipboard-indicator@tudmotu.com`)
4. Compiz Windows Effect (`compiz-windows-effect@hermes83.github.com`)
5. Tiling Assistant (`tiling-assistant@leleat-on-github`)
6. Touchpad Gesture Customization (`touchpad-gesture-customization@coooolapps.com`)
7. Transparent Top Bar (`transparent-top-bar@ftpix.com`)
8. WACK Shell (`wack-shell@rinzler69-wastaken.github.com`)
9. Apps Menu (`apps-menu@gnome-shell-extensions.gcampax.github.com`)
10. Dash to Dock (`dash-to-dock@micxgx.gmail.com`)
11. Places Status Indicator (`places-menu@gnome-shell-extensions.gcampax.github.com`)
12. Text Extractor (`text-extractor@imshaaz21.github.com`)
13. Emoji Copy (`emoji-copy@felipeftn`)

### KEYBINDING & UTILITY MATRIX
- `Super + Shift + T` : OCR Screen Snip Extractor
- `Super + .` : Searchable Emoji Copy Overlay
- `Super + /` : Dynamic Shortcuts & Custom Command Manager
- `Super + Shift + C` : Close Workspace Applications
- `Alt + Tab` : Global Multi-Workspace Window Switcher
- Font Antialiasing : Grayscale rendering

---

### COLLABORATION GUIDELINES
Use this context as background knowledge. Feel free to adapt flexibly to any request, creative workflow, optimization, or troubleshooting intent with full creative freedom.

---

### MY TASK / QUESTION:
[Insert your question or request here]


# 🚀 Fedora GNOME Workstation Setup & Configuration Suite

Low-latency Fedora GNOME Workstation configuration repository featuring automated keybinding persistence, modular package management, floating translucent dock, instant fingerprint unlock, multi-workspace navigation, and custom utilities.[cite: 5]

---

## 📋 1. Pre-Installation Setup (Windows Preparation)

Before installing Fedora Workstation alongside or over Windows, complete these mandatory preparation steps:

### A. Disable BitLocker & Decrypt Storage
1. Open **Control Panel** (or **Settings** > **Privacy & Security** > **Device Encryption**).
2. Open **BitLocker Drive Encryption**.
3. Click **Turn off BitLocker** / **Turn off Encryption**.
4. **Crucial:** Wait until drive decryption reaches **100%** before resizing partitions or booting the Linux installer (prevents locked partitions and installer crashes).

### B. Disable Windows Fast Startup
1. Open **Control Panel** > **Hardware and Sound** > **Power Options**.
2. Click **Choose what the power buttons do** in the left sidebar.
3. Click **Change settings that are currently unavailable**.
4. Uncheck **Turn on fast startup (recommended)** and click **Save changes** (prevents Windows from leaving drive controllers in a locked hibernation state).

### C. Create Bootable USB Media via Rufus
1. Download the latest **Fedora Workstation ISO** and launch **Rufus** on Windows.
2. Select your USB flash drive (8GB+ required).
3. Set **Partition scheme** to `GPT`.
4. Set **Target system** to `UEFI (non CSM)`.
5. Click **START**.
6. When Rufus prompts for image writing mode, select **Write in DD Image mode** to ensure clean UEFI installer boot media.

---

## ⚙️ 2. BIOS / UEFI Configurations

1. Restart your PC and tap the BIOS setup key (`F2`, `F12`, or `Del`).
2. Set **SATA Controller Mode** to **AHCI** (disable Intel VMD / RST if enabled).
3. Ensure **UEFI Boot Mode** is active and **Secure Boot** is configured according to your driver needs.

---

## 💻 3. Post-Install Workspace Synchronization

Once booted into Fedora Workstation, open a terminal to clone your repository and sync your environment[cite: 5]:

```bash
git clone https://github.com/MehulK-techie/fedora-workstation-config.git
cd fedora-workstation-config
chmod +x sync.sh
./sync.sh "init: workstation configuration active"