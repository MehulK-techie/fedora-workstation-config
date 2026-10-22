┌──────────────────────────────────────────────────────────────────────────┐
│                         ACTIVE EXTENSIONS (8)                            │
├───────────────────────────────────┬──────────────────────────────────────┤
│ 1. Touchpad Gesture Customization │ Custom 3/4-finger Wayland gestures   │
│ 2. Blur my Shell                  │ Frosted glass blur on panel & dock   │
│ 3. Astra Monitor                  │ Live top-bar CPU/RAM/Disk/Net stats  │
│ 4. Transparent Top Bar            │ Dynamic panel background opacity     │
│ 5. WACK Shell                     │ macOS Sonoma desktop UI aesthetics   │
│ 6. OCR Text Extractor             │ Extract text from screen selection   │
│ 7. Places Status Indicator        │ Quick file system navigation menu    │
│ 8. Dash to Dock                   │ Persistent launcher dock with auto-hide│
└───────────────────────────────────┴──────────────────────────────────────┘


---

## 1. Active Extensions (Currently Enabled)

### 1. Touchpad Gesture Customization (`touchpad-gesture-customization@coooolapps.com`)
* **What It Does:** Replaces standard GNOME Wayland gestures with 1:1 fluid touchpad controls. Allows mapping 3-finger and 4-finger swipes/pinches to custom desktop actions (e.g., workspace cycling, overview toggle).
* **How to Configure:**
  * **GUI:** Open **Extension Manager** $\rightarrow$ Click **⚙️ Gear Icon** next to **Touchpad Gesture Customization**.
  * **CLI:** `gnome-extensions prefs touchpad-gesture-customization@coooolapps.com`

---

### 2. Blur my Shell (`blur-my-shell@aunetx`)
* **What It Does:** Renders frosted-glass blur effects across GNOME Shell UI components, including the top bar panel, application overview, popups, menus, and Dash to Dock.
* **How to Configure:**
  * **GUI:** **Extension Manager** $\rightarrow$ **⚙️ Gear Icon** next to **Blur my Shell**.
  * **Key Settings:** Choose between **Static Blur** and **Dynamic Blur**, adjust blur radius, and toggle panel blur auto-disable when windows touch the top bar.
  * **CLI:** `gnome-extensions prefs blur-my-shell@aunetx`

---

### 3. Astra Monitor (`monitor@astraext.github.io`)
* **What It Does:** Adds a performance monitoring dashboard directly into your GNOME top bar. Displays real-time graphs and numerical indicators for CPU usage, RAM allocation, GPU metrics, disk read/write speeds, network throughput, and hardware temperatures.
* **How to Configure:**
  * **GUI:** **Extension Manager** $\rightarrow$ **⚙️ Gear Icon** next to **Astra Monitor**.
  * **Key Settings:** Choose metrics displayed in header bar vs. drop-down menu, adjust polling frequency, and set sensor display units.
  * **CLI:** `gnome-extensions prefs monitor@astraext.github.io`

---

### 4. Transparent Top Bar (`transparent-top-bar@ftpix.com`)
* **What It Does:** Automatically turns the top bar panel transparent when no windows are maximized or near the top edge.
* **How to Configure:**
  * **GUI:** **Extension Manager** $\rightarrow$ **⚙️ Gear Icon**.
  * **CLI:** `gnome-extensions prefs transparent-top-bar@ftpix.com`

---

### 5. WACK Shell (`wack-shell@rinzler69-wastaken.github.com`)
* **What It Does:** Restyles GNOME Shell with rounded panel edges, macOS Sonoma-like drop-shadows, translucent popover menus, and sleek window borders.
* **How to Configure:**
  * **GUI:** **Extension Manager** $\rightarrow$ **⚙️ Gear Icon**.
  * **CLI:** `gnome-extensions prefs wack-shell@rinzler69-wastaken.github.com`

---

### 6. OCR Text Extractor (`text-extractor@imshaaz21.github.com`)
* **What It Does:** Captures a box selection on screen, runs OCR processing, and copies recognized text directly to your system clipboard.
* **How to Configure:**
  * **GUI:** **Extension Manager** $\rightarrow$ **⚙️ Gear Icon**.
  * **CLI:** `gnome-extensions prefs text-extractor@imshaaz21.github.com`

---

### 7. Places Status Indicator (`places-menu@gnome-shell-extensions.gcampax.github.com`)
* **What It Does:** Adds a drop-down menu in the top bar for quick access to standard system directories (Home, Downloads, Documents, Pictures, Networks, and mounted drives).

---

### 8. Dash to Dock (`dash-to-dock@micxgx.gmail.com`)
* **What It Does:** Unpins the application launcher dock from the Overview screen and keeps it permanently visible on your desktop with intelligent auto-hide support.
* **How to Configure:**
  * **GUI:** Right-click dock $\rightarrow$ **Dash to Dock Settings** (or click **⚙️ Gear Icon** in Extension Manager).
  * **CLI:** `gnome-extensions prefs dash-to-dock@micxgx.gmail.com`

---

## 2. Inactive Extensions (Installed Standby Pool)

| Extension Name | Extension UUID | Functionality |
| :--- | :--- | :--- |
| **Caffeine** | `caffeine@patapon.info` | Prevents auto-suspend and screen lock via top bar toggle. |
| **Clipboard Indicator** | `clipboard-indicator@tudmotu.com` | Clipboard manager maintaining history of copied text. |
| **Compiz Windows Effect** | `compiz-windows-effect@hermes83.github.com` | Adds wobbly window physics when dragging windows. |
| **Magic Lamp Effect** | `compiz-alike-magic-lamp-effect@hermes83.github.com` | macOS genie/lamp animation when minimizing windows. |
| **Burn My Windows** | `burn-my-windows@schneegans.github.com` | Animated window closing effects (fire, matrix, portal). |
| **Just Perfection** | `just-perfection-desktop@just-perfection` | Tweaks GNOME Shell UI elements (hide search, panel, OSDs). |
| **CoverFlow Alt+Tab** | `CoverflowAltTab@palatis.blogspot.com` | 3D coverflow style window switcher animation. |
| **Quick Settings Tweaks** | `quick-settings-tweaks@qwreey` | Customizes volume, media control, and quick toggles. |
| **Tiling Assistant** | `tiling-assistant@leleat-on-github` | Windows/KDE-style quarter-screen window snapping. |

---

## 3. Extension Management Cheat Sheet

```bash
# Query currently active extensions
gnome-extensions list --enabled

# Enable or disable an extension on the fly
gnome-extensions enable <extension-uuid>
gnome-extensions disable <extension-uuid>

# Open settings menu for any extension directly
gnome-extensions prefs <extension-uuid>

# Export current extension configuration array
gsettings get org.gnome.shell enabled-extensions