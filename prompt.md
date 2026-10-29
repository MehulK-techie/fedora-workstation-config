# MK-Workstation: Master Architecture & Complete AI Prompt Transcript (prompt.md)

> **Project:** MK-Workstation (`fedora-workstation-config`)  
> **Repository:** `https://github.com/MehulK-techie/fedora-workstation-config`  
> **Target OS:** Fedora Linux (GNOME 46+, Wayland, Mutter)  
> **License:** MIT License  
> **Author:** Mehul Kumar  
> **Hackathon Track:** Open Innovation / Systems Architecture  
> **Target Evaluation Rubrics:** AI Workflow & Prompt Transcript (15/100 Points), Engineering Quality & Reliability (20/100 Points)

---

## 1. Executive Summary & Build Narrative

### The Lockdown Daily Driver & The Mentor's Guidance
MK-Workstation is an emotional passion project. During the lockdown, receiving this laptop was the spark that ignited my love for programming, Linux, and computing. Through every late night, classroom project, and self-taught engineering sprint, this machine has been my faithful daily driver.

Recently, upon switching to Fedora Linux, my mentor gave me two foundational directives:
1. *"Take notes, take notes, take notes."*
2. *"Start contributing to open source."*

### The Friction That Conceived MK-Workstation
When customizing Fedora to handle my daily workload, I ran into the steep friction that almost every first-time Linux user endures:
- **Biometric Nightmare:** Setting up webcam Face ID via Howdy and the fingerprint reader via `fprintd` resulted in device lockouts (`/dev/video0`), ambient light timeouts, and broken PAM configuration chains.
- **Paywalled & Bloated Note Apps:** Tools like Notion and Obsidian locked basic collaboration/styling behind subscription paywalls or ran on heavy Electron web wrappers that consumed excessive memory.
- **The "Windows + macOS" Void:** Wanting macOS-grade compositor fluidity and trackpad gestures combined with Windows 11 window management shortcuts (`Super + 1..9`, `Super + V`).

Rather than keeping local fixes trapped in shell histories, I architected **MK-Workstation**: an Infrastructure-as-Code (IaC) setup open-sourced under the **MIT License**. With a single command (`./sync.sh`), any user can convert a fresh Fedora installation into an optimized, battery-friendly daily driver.

---

## 2. Foundational Master System Specification (XML Architecture)

```xml
<role>
You are a Senior Linux Systems Engineer and GNOME/Wayland UI/UX Architect specializing in Fedora Workstation Infrastructure-as-Code (IaC) configuration, PAM authentication stacks, GNOME Shell extension patches, and custom D-Bus / MPRIS integrations.
</role>

<context>
I am building a portable, zero-touch setup repository (`MehulK-techie/fedora-workstation-config`) on Fedora Workstation (Wayland / GNOME 46+). 

My goal is to transform the system into an ultra-fast, macOS-fluid environment with working biometrics, custom lock screen behavior, fixed media widgets, power/RAM sleeping window management, advanced note-taking tools, and hidden easter eggs—deployable to any hardware via a single `mk` command.
</context>

<objective>
Generate an audited, production-ready script update for `setup.sh`, PAM auth configurations, GNOME Shell CSS overrides, extension patch files, and an interactive onboarding tour script to execute all specifications cleanly without system errors or bloat.
</objective>

<specifications>
  <hardware_pam_security_biometrics>
    <fingerprint_and_gdm_fixes>
- Lock Screen Prompt Fix: Resolve the GDM hang where placing a finger on the sensor gets stuck. Configure `fprintd` and `/etc/pam.d/gdm-fingerprint` so valid fingerprint matches instantly unlock the desktop session.
- Low-Light Password Timeout: Increase GDM authentication timeout before password prompt fallback when low-light face recognition is delayed. Display sensor attempt counts and trigger temporary lockouts after maximum failed attempts.
- Post-Unlock Dock Visibility: Fix the bug where the desktop dock remains invisible after unlocking from the lock screen until the cursor moves.
    </fingerprint_and_gdm_fixes>

    <keyring_and_app_biometrics>
- Keyring Prompt Suppression: Eliminate persistent Seahorse/Gnome-Keyring authentication popups when launching apps like Spotify, VS Code, or Zen Browser.
- Biometric App & File Locker: Implement a unified PAM/biometric lock utility for individual applications, specific Nautilus folders/files, and MK Notes using fingerprint or face authentication.
- Multi-Profile Face Recognition: Support up to two distinct facial profiles (Main User + Guest Mode) using `howdy` or `fprintd`. Guest profile maps to an isolated session layout.
    </keyring_and_app_biometrics>
  </hardware_pam_security_biometrics>

  <system_ui_dock_and_wallpapers>
    <dock_and_topbar>
- Dock Magnification: Force single-layer 1:1 icon zoom scaling in Dash to Dock; remove ghosting/overlapping icon layers.
- Top Bar Finder Shortcuts: Display keybinding shortcuts (e.g., `Super+Shift+S`) next to Shutdown, Restart, and Sleep in the top-left menu, dynamically updating if remapped.
    </dock_and_topbar>

    <wallpapers_and_themes>
- Lego Batman Theme: Realistic high-detail Lego aesthetic wallpaper/accent styling.
- Spider-Man Theme: High-res urban skyscraper web-slinging wallpaper (removing moon motifs).
    </wallpapers_and_themes>
  </system_ui_dock_and_wallpapers>

  <power_ram_kernel_performance>
    <sleeping_windows_and_monitoring>
- Sleeping Windows (RAM Saver): Automatically freeze/suspend background unused windows using cgroups/systemd to save memory and battery.
- Astra Monitor UI: Display all hardware temperatures strictly in Celsius (°C). Provide clean, readable CPU/RAM graphs and an integrated network speed test utility.
    </sleeping_windows_and_monitoring>

    <kernel_caching_and_tweaks>
- System Responsiveness: Apply kernel sysctl optimizations (`vm.swappiness=10`, `vm.vfs_cache_pressure=50`) and configure build/system caching (`ccache` / `zram` tuning) for fast app responsiveness.
    </kernel_caching_and_tweaks>
  </power_ram_kernel_performance>

  <mk_notes_app_overhaul>
    <editor_and_image_processing>
- Inline Image Rendering: Intercept dropped/pasted images and render actual photo thumbnails inline within notes rather than pasting file path text (`/path/to/img`).
- In-App Image Editor: Allow clicking photos in edit mode to resize, crop, rotate, and apply filters (Photo Booth effects, Polaroid vintage mode).
- Direct PDF Export: Export notes directly to a `.pdf` file in the chosen target folder without opening a system print preview dialog window.
- Note-Taking Tools: Self-explanatory toolbar with search, Markdown syntax, auto-saving, note pinning, and protocol-handled hyperlinks (`xdg-open`).
    </editor_and_image_processing>
  </mk_notes_app_overhaul>

  <alt_tab_media_softimer>
    <alt_tab_switcher>
- Rebind `Alt+Tab` to instant `switch-windows` with a compact, non-fullscreen card overlay and zero preview delay.
    </alt_tab_switcher>

    <spotify_mpris_integration>
- Static Title: Display ONLY song title truncated with ellipsis (`text-overflow: ellipsis`); disable continuous marquee scrolling.
- Artist Info & Expand: Hide artist name until clicked/expanded; add a "More" control button.
- MPRIS Focus Fix: Repair Play/Pause D-Bus calls and bind "Open Player" to reliably raise and focus the active player window.
- Panel Animation: Smooth CSS fade-out transition when media playback closes.
    </spotify_mpris_integration>

    <softimer_fixes>
- Repair broken sound preset asset paths and the "Surprise Me" randomizer.
- Direct Duration Input: Open Softimer -> Type duration -> Press Enter to start timer immediately.
    </softimer_fixes>
  </alt_tab_media_softimer>

  <file_management_overhaul>
    <nautilus_enhancements>
- Package Swaps: Remove `gThumb`; install GNOME `sushi` (Spacebar Quick Look), `loupe`, `nautilus-extensions`, and `file-roller`.
- Productivity Features: Typeable path bar (`Ctrl+L`), native `Ctrl+X`/`Ctrl+V` cut/paste, right-click terminal option, visual multi-rule batch renaming (`F2`), folder biometric lock, and advanced file filtering.
    </nautilus_enhancements>
  </file_management_overhaul>

  <boot_greeting_easter_eggs_and_tour>
    <greeting_and_quick_settings>
- Context-Aware Greeting: Differentiate 1st boot of calendar day from same-day reboots.
- Toggleable Birthday Countdown: Configurable date (`BIRTHDAY_DATE="YYYY-MM-DD"`) displaying time remaining with an independent toggle flag.
- Quick Settings UI Layout Fix: Wrap greeting radio/option menus in a constrained scroll container so the "Edit greeting" button stays visible.
    </greeting_and_quick_settings>

    <easter_eggs_and_onboarding>
- Hidden Easter Eggs: Subtle system easter eggs honoring Spider-Man, tech legends, classic Linux memes, Linus Torvalds, Fedora, and Claude.
- Interactive Tour (`mk-tour`): Re-accessible terminal command guiding new users through installed apps, shortcuts, and features.
    </easter_eggs_and_onboarding>
  </boot_greeting_easter_eggs_and_tour>

  <portability_and_installer>
    <zero_touch_deployment>
- Interactive Installer: Detect hardware (fingerprint sensor, webcam), prompt user for face/fingerprint setup, apply all extension profiles, and create the `mk` CLI system alias.
    </zero_touch_deployment>
  </portability_and_installer>
</specifications>