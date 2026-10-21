# 🤖 Fedora Workstation AI Collaboration Master Prompt

> **Instructions for the User:** Copy and paste everything below the line into any AI (ChatGPT, Claude, Gemini) along with your question or feature request. It gives the AI full architecture context, active extensions, custom keybindings, and system configurations.

---

### **System Context & Workstation Architecture**
* **Operating System:** Fedora Workstation (GNOME Shell on Wayland)
* **GitHub Repository:** `MehulK-techie/fedora-workstation-config` (Branch: `main`)
* **Local Repo Path:** `~/Desktop/Fedora_workspace_MK`
* **Design Philosophy:** Polished, performance-optimized hybrid macOS/Windows workflow.

---

### **Active Extensions Inventory (12 Total)**
1. **Astra Monitor** (`monitor@astraext.github.io`)
2. **Blur my Shell** (`blur-my-shell@aunetx`)
3. **Clipboard Indicator** (`clipboard-indicator@tudmotu.com`)
4. **Compiz Windows Effect** (`compiz-windows-effect@hermes83.github.com`)
5. **Tiling Assistant** (`tiling-assistant@leleat-on-github`)
6. **Touchpad Gesture Customization** (`touchpad-gesture-customization@coooolapps.com`)
7. **Transparent Top Bar** (`transparent-top-bar@ftpix.com`)
8. **WACK Shell** (`wack-shell@rinzler69-wastaken.github.com`)
9. **Apps Menu** (`apps-menu@gnome-shell-extensions.gcampax.github.com`)
10. **Dash to Dock** (`dash-to-dock@micxgx.gmail.com`)
11. **Places Status Indicator** (`places-menu@gnome-shell-extensions.gcampax.github.com`)
12. **OCR Text Extractor** (`text-extractor@imshaaz21.github.com`)

---

### **Custom Binaries & Keybindings**
* **`Super + Shift + T`** $\rightarrow$ `ocr-snip` (Interactive GTK area-selection OCR tool) / `text-extractor`
* **`Super + .`** $\rightarrow$ `gnome-characters` (Windows-style emoji picker board)
* **`Super + /`** $\rightarrow$ `show-shortcuts` (Native Python GTK hotkey cheat sheet popup)
* **`Super + Shift + C`** $\rightarrow$ `close-workspace-apps` (Closes all open windows in current workspace via `wmctrl`)
* **`Super + S` / `Super + Tab`** $\rightarrow$ Workspace Overview Matrix
* **`Alt + Tab`** $\rightarrow$ Global multi-workspace window switcher (frosted glass background)

---

### **Core System & Performance Enhancements**
* **Mutter Engine:** Variable Refresh Rate (VRR) & fractional scale framebuffers enabled.
* **Physics Tuning:** Optimized Compiz wobbly window mesh calculation ($6 \times 6$ tessellation limit) for smooth 60+ FPS 4-finger touchpad pinches.
* **Audio & Visuals:** 150% sound boost, RGBA subpixel antialiasing, dark theme preferred, top-bar battery percentage.
* **System Permanence:** PAM fingerprint authentication (`fprintd` via `authselect`).

---

### **My Request for the AI:**
*(Type your request or describe the issue here. For example: "I want to add a hotkey for toggling dark mode" or "Help me troubleshoot an extension error.")*
